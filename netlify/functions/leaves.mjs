import { getStore } from "@netlify/blobs";

/* 휴가 목록 API — 사이트가 저장소다. 시트·외부 서비스 없음.
   GET    /api/leaves         전체 목록
   POST   /api/leaves         { name, start, end?, note? } 추가
   DELETE /api/leaves?id=...  한 건 삭제

   ponytail: 목록 전체를 blob 한 개에 넣고 읽기-수정-쓰기 한다. 두 사람이 같은 순간에
   등록하면 뒤엣것이 앞엣것을 덮을 수 있다(10명 규모에선 사실상 안 일어남).
   동시 등록이 실제로 문제가 되면 레코드별 키(leave/<id>)로 쪼개고 list({prefix}) 로 모을 것. */

const KEY = "leaves";
const MAX = 2000;                       // 무한 증식 방지
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
  if (end < start) return null;                                  // ISO 문자열은 사전순=시간순
  if (new Date(end) - new Date(start) > 366 * 864e5) return null; // 1년 넘는 건은 오타
  return { id: crypto.randomUUID(), name, start, end, note };
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });

/* TEAM_PASSCODE 환경변수를 넣으면 쓰기(등록·삭제)에 암호를 요구한다.
   안 넣으면 주소를 아는 사람 누구나 쓸 수 있다 — README 참고. */
function denied(req){
  const need = process.env.TEAM_PASSCODE;
  if (!need) return false;
  return req.headers.get("x-team-passcode") !== need;
}

export default async (req) => {
  const store = getStore(STORE);
  const read = async () => (await store.get(KEY, { type: "json" })) || [];

  if (req.method === "GET") return json(await read());

  if (req.method === "POST"){
    if (denied(req)) return json({ error: "암호가 맞지 않습니다." }, 401);
    let body;
    try { body = await req.json(); } catch { return json({ error: "형식 오류" }, 400); }
    const rec = clean(body);
    if (!rec) return json({ error: "입력값을 확인하세요." }, 400);
    const list = await read();
    if (list.length >= MAX) return json({ error: "목록이 가득 찼습니다." }, 409);
    list.push(rec);
    await store.setJSON(KEY, list);
    return json(rec, 201);
  }

  if (req.method === "DELETE"){
    if (denied(req)) return json({ error: "암호가 맞지 않습니다." }, 401);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return json({ error: "id 가 필요합니다." }, 400);
    const list = await read();
    const next = list.filter(r => r.id !== id);
    if (next.length === list.length) return json({ error: "없는 항목입니다." }, 404);
    await store.setJSON(KEY, next);
    return json({ ok: true });
  }

  return json({ error: "지원하지 않는 방식" }, 405);
};

export const config = { path: "/api/leaves" };
export { clean, isDate };          // 자가검증용
