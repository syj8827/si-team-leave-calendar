import { getStore } from "@netlify/blobs";

/* 일정 목록 API — 사이트가 저장소다. 시트·외부 서비스 없음.
   GET    /api/leaves          목록
   GET    /api/leaves?trash=1  삭제된 것(툼스톤) 목록 — 복구용
   POST   /api/leaves          { name, start, end?, note? } 추가
   DELETE /api/leaves?id=...   삭제 (지우지 않고 trash/ 로 옮긴다)

   ── 왜 레코드마다 blob 을 따로 쓰는가
   목록 전체를 한 blob 에 담아 읽기-수정-쓰기 하면 두 사람이 몇 초 안에 등록할 때
   뒤엣것이 앞엣것을 덮는다(실제로 기록이 하나 사라진 적 있다). @netlify/blobs 8.2 에는
   조건부 쓰기(onlyIfMatch)가 없어 그 방식은 안전하게 만들 수 없다. 레코드별로 쪼개면
   쓰기끼리 키가 겹치지 않으므로 덮어쓰기가 구조적으로 불가능하다.

   ── 왜 consistency:"strong"
   기본값은 최종적 일관성이라 등록 직후 읽기에 예전 값이 돌아와, 방금 넣은 건이
   사라진 것처럼 보인다. */

const LIVE = "leave/";
const TRASH = "trash/";
const RATE = "rl/";
const STORE = "vacation";

const MAX = 500;                 // 이 이상은 읽기 비용이 커진다(목록 조회가 레코드 수만큼 get 을 낸다)
const RATE_LIMIT = 20;           // 분당 쓰기 허용 횟수 (같은 IP)
const YEAR_MIN = 2020, YEAR_MAX = 2100;

const isDate = s => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y,m,d] = s.split("-").map(Number);
  if (y < YEAR_MIN || y > YEAR_MAX) return false;
  const t = new Date(y, m-1, d);
  return t.getFullYear() === y && t.getMonth() === m-1 && t.getDate() === d;
};

/* 신뢰 경계 — 클라이언트가 보낸 값은 전부 여기서 다시 검사한다.
   제어문자를 걸러 두면 저장된 값이 화면에서 이상하게 깨지는 것도 막는다.
   태그 문자열 자체는 막지 않는다(사람 이름에 쓸 수도 있으니) — 출력 이스케이프가 담당한다. */
function clean(b){
  if (!b || typeof b !== "object") return null;
  const strip = v => String(v ?? "")
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/g, "")
    .trim();
  const name = strip(b.name), note = strip(b.note);
  const start = strip(b.start);
  const end = strip(b.end) || start;
  if (!name || name.length > 20) return null;
  if (note.length > 40) return null;
  if (!isDate(start) || !isDate(end)) return null;
  if (end < start) return null;                                   // ISO 문자열은 사전순=시간순
  if (new Date(end) - new Date(start) > 366 * 864e5) return null;  // 1년 넘는 건은 오타
  return { id: crypto.randomUUID(), name, start, end, note };
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-api": "v3"                 // 쓰기 없이 배포 버전을 확인하는 표식
    }
  });

/* TEAM_PASSCODE 를 넣으면 쓰기에 암호를 요구한다. 안 넣으면 주소를 아는 사람 누구나 쓸 수 있다. */
function denied(req){
  const need = process.env.TEAM_PASSCODE;
  return !!need && req.headers.get("x-team-passcode") !== need;
}

/* 분당 쓰기 횟수 제한. 카운터의 읽기-수정-쓰기에는 경쟁이 있지만 제한은 근사치로 충분하다.
   목적은 정확한 계량이 아니라 자동 스팸으로 목록이 가득 차거나 전부 삭제되는 것을 늦추는 것이다. */
async function rateLimited(store, req){
  const ip = (req.headers.get("x-nf-client-connection-ip")
    || req.headers.get("x-forwarded-for") || "?").split(",")[0].trim();
  const key = `${RATE}${ip}/${Math.floor(Date.now() / 60000)}`;
  const n = Number(await store.get(key, { type: "text" }).catch(() => 0)) || 0;
  if (n >= RATE_LIMIT) return true;
  await store.set(key, String(n + 1));
  return false;
}

/* ponytail: 레코드 수만큼 get 을 병렬로 던진다. MAX 500 이면 안전하고, 팀 규모에서
   몇 해를 써도 닿지 않는다. 그보다 커지면 키에 연도를 넣어(leave/2026/<id>)
   보고 있는 연도만 읽는 쪽으로 바꿀 것. */
async function readAll(store, prefix){
  const { blobs } = await store.list({ prefix });
  const recs = await Promise.all(
    blobs.map(b => store.get(b.key, { type: "json" }).catch(() => null))
  );
  return recs.filter(r => r && r.id && r.name && r.start)
             .sort((a,b) => a.start.localeCompare(b.start));
}

export default async (req) => {
  const store = getStore({ name: STORE, consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET"){
    /* 삭제된 것도 남겨 두므로, 누가 전부 지워도 여기서 되찾을 수 있다 */
    if (url.searchParams.get("trash")) return json(await readAll(store, TRASH));
    return json(await readAll(store, LIVE));
  }

  if (req.method === "POST"){
    if (denied(req)) return json({ error: "암호가 맞지 않습니다." }, 401);
    /* content-type 을 못 박으면 다른 사이트에서 preflight 없이 몰래 쓰는 걸 막는다 */
    if (!(req.headers.get("content-type") || "").includes("application/json"))
      return json({ error: "content-type 은 application/json 이어야 합니다." }, 415);
    if (await rateLimited(store, req))
      return json({ error: "잠시 후 다시 시도해 주세요." }, 429);

    let body;
    try { body = await req.json(); } catch { return json({ error: "형식 오류" }, 400); }
    const rec = clean(body);
    if (!rec) return json({ error: "입력값을 확인하세요." }, 400);

    const { blobs } = await store.list({ prefix: LIVE });
    if (blobs.length >= MAX) return json({ error: "목록이 가득 찼습니다." }, 409);

    await store.setJSON(LIVE + rec.id, rec);      // 읽기-수정-쓰기 없음 → 덮어쓰기 불가
    return json(rec, 201);
  }

  if (req.method === "DELETE"){
    if (denied(req)) return json({ error: "암호가 맞지 않습니다." }, 401);
    if (await rateLimited(store, req))
      return json({ error: "잠시 후 다시 시도해 주세요." }, 429);

    const id = url.searchParams.get("id");
    if (!id || !/^[A-Za-z0-9_-]{6,64}$/.test(id))
      return json({ error: "id 가 올바르지 않습니다." }, 400);

    const rec = await store.get(LIVE + id, { type: "json" }).catch(() => null);
    if (!rec) return json({ error: "없는 항목입니다." }, 404);

    /* 지우지 않고 옮긴다 — 실수든 장난이든 되돌릴 수 있어야 한다 */
    await store.setJSON(TRASH + id, { ...rec, deletedAt: new Date().toISOString() });
    await store.delete(LIVE + id);
    return json({ ok: true });
  }

  return json({ error: "지원하지 않는 방식" }, 405);
};

export const config = { path: "/api/leaves" };
export { clean, isDate };          // 자가검증용
