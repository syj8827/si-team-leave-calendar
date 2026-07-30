import { getStore } from "@netlify/blobs";

/* 휴가 목록 API — 사이트가 저장소다. 시트·외부 서비스 없음.
   GET    /api/leaves         전체 목록
   POST   /api/leaves         { name, start, end?, note? } 추가
   DELETE /api/leaves?id=...  한 건 삭제

   레코드마다 blob 을 하나씩 쓴다(`leave/<id>`). 목록 전체를 한 blob 에 넣고
   읽기-수정-쓰기 하면 두 사람이 몇 초 안에 등록할 때 뒤엣것이 앞엣것을 덮는다 —
   @netlify/blobs 8.2 에는 조건부 쓰기(onlyIfMatch)가 없어 그 방식은 안전하게 만들 수 없다.
   레코드별로 쪼개면 쓰기끼리 겹치지 않으므로 덮어쓰기가 구조적으로 불가능하다.

   consistency:"strong" 이 없으면 기본값이 최종적 일관성이라, 등록 직후 읽기에
   예전 값이 돌아와 방금 넣은 건이 사라진 것처럼 보인다. */

const PREFIX = "leave/";
const LEGACY = "leaves";          // 예전 단일 blob (있으면 옮기고 지운다)
const MAX = 2000;
const STORE = "vacation";

const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && (() => {
  const [y,m,d] = s.split("-").map(Number);
  const t = new Date(y, m-1, d);
  return t.getFullYear() === y && t.getMonth() === m-1 && t.getDate() === d;
})();

/* 신뢰 경계 — 클라이언트가 보낸 값은 전부 여기서 다시 검사한다 */
function clean(b){
  if (!b || typeof b !== "object") return null;
  const name = String(b.name ?? "").trim();
  const note = String(b.note ?? "").trim();
  const start = String(b.start ?? "").trim();
  const end = String(b.end ?? "").trim() || start;
  if (!name || name.length > 20) return null;
  if (note.length > 40) return null;
  if (!isDate(start) || !isDate(end)) return null;
  if (end < start) return null;                                   // ISO 문자열은 사전순=시간순
  if (new Date(end) - new Date(start) > 366 * 864e5) return null;  // 1년 넘는 건은 오타
  return { id: crypto.randomUUID(), name, start, end, note };
}

/* x-api 는 배포된 버전을 쓰기 없이 확인하는 표식이다 (구 버전 판별용) */
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-api": "per-record-strong"
    }
  });

/* TEAM_PASSCODE 환경변수를 넣으면 쓰기(등록·삭제)에 암호를 요구한다.
   안 넣으면 주소를 아는 사람 누구나 쓸 수 있다 — README 참고. */
function denied(req){
  const need = process.env.TEAM_PASSCODE;
  if (!need) return false;
  return req.headers.get("x-team-passcode") !== need;
}

/* 예전 단일 blob 이 남아 있으면 레코드별로 옮긴 뒤 지운다. 같은 id 는 같은 키에
   같은 내용으로 다시 쓰이므로 동시에 두 번 돌아도 문제 없다. */
async function migrate(store){
  const old = await store.get(LEGACY, { type: "json" }).catch(() => null);
  if (!Array.isArray(old) || !old.length) return;
  await Promise.all(old.map(r => {
    const id = r?.id || crypto.randomUUID();
    return store.setJSON(PREFIX + id, { ...r, id });
  }));
  await store.delete(LEGACY);
}

/* ponytail: 레코드 수만큼 get 을 병렬로 던진다. 한 해 100~200건 규모에선 문제없고,
   수천 건으로 커지면 연도별 blob 에 묶어 읽는 쪽으로 바꿀 것. */
async function readAll(store){
  const { blobs } = await store.list({ prefix: PREFIX });
  const recs = await Promise.all(
    blobs.map(b => store.get(b.key, { type: "json" }).catch(() => null))
  );
  return recs.filter(r => r && r.id && r.name && r.start)
             .sort((a,b) => a.start.localeCompare(b.start));
}

export default async (req) => {
  /* strong 이 아니면 등록 직후 읽기에 예전 값이 온다 */
  const store = getStore({ name: STORE, consistency: "strong" });

  if (req.method === "GET"){
    await migrate(store);
    return json(await readAll(store));
  }

  if (req.method === "POST"){
    if (denied(req)) return json({ error: "암호가 맞지 않습니다." }, 401);
    let body;
    try { body = await req.json(); } catch { return json({ error: "형식 오류" }, 400); }
    const rec = clean(body);
    if (!rec) return json({ error: "입력값을 확인하세요." }, 400);
    const { blobs } = await store.list({ prefix: PREFIX });
    if (blobs.length >= MAX) return json({ error: "목록이 가득 찼습니다." }, 409);
    await store.setJSON(PREFIX + rec.id, rec);      // 읽기-수정-쓰기 없음 → 덮어쓰기 불가
    return json(rec, 201);
  }

  if (req.method === "DELETE"){
    if (denied(req)) return json({ error: "암호가 맞지 않습니다." }, 401);
    const id = new URL(req.url).searchParams.get("id");
    if (!id || !/^[A-Za-z0-9_-]{6,64}$/.test(id)) return json({ error: "id 가 올바르지 않습니다." }, 400);
    const key = PREFIX + id;
    if (!await store.get(key, { type: "json" }).catch(() => null))
      return json({ error: "없는 항목입니다." }, 404);
    await store.delete(key);
    return json({ ok: true });
  }

  return json({ error: "지원하지 않는 방식" }, 405);
};

export const config = { path: "/api/leaves" };
export { clean, isDate };          // 자가검증용
