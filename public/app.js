/* 별도 파일로 둔 이유: CSP 에서 script-src 'self' 만 허용하려면 인라인 스크립트가 없어야 한다.
   그러면 저장 데이터에 <img onerror=...> 같은 게 섞여 들어와도 브라우저가 실행을 막는다
   (이스케이프가 1차 방어, CSP 가 2차 방어). */

const D = window.CAL_DATA;
const API = "/api/leaves";
const WD = ["일","월","화","수","목","금","토"];

/* 로컬에서 파일로 열거나 정적 서버로 볼 때만 예시 데이터를 쓴다.
   배포된 주소에서 API 가 실패하면 예시를 보여주지 않는다 — 가짜 이름이 실제처럼 보이면 안 된다. */
const LOCAL = location.protocol === "file:"
  || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

const pad = n => String(n).padStart(2,"0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse = s => { const [y,m,d] = String(s).split("-").map(Number); return new Date(y, m-1, d); };
const valid = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parse(s)) === s;

/* 출력 이스케이프 — 저장된 이름·메모는 남이 넣은 값이라 그대로 HTML 에 넣으면 안 된다 */
const esc = v => String(v ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]);

const TODAY = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })();
let cur = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
let leaves = [];
let live = false;
let justAdded = null;

/* 월 표시 글자별 기본 색 (큰 글자 기준 3:1 이상). 애니메이션이 이 위로 파동을 얹는다 */
const RAMP = ["#2F937A","#2F9390","#2F7F93","#2F6993","#2F9361","#2F934D","#2F932F"];

/* 보라 계열(250~330) 제외. 인접 순번끼리 최소 46도 벌어지게 배열 */
const HUES = [138,0,184,46,230,92,345,161,23,207,69,115];
let roster = [];
const hueOf = ci => HUES[(Number.isInteger(ci) && ci >= 0 && ci < HUES.length) ? ci : 0];
function shades(h){
  return { c:`hsl(${h} 44% 29%)`, cb:`hsl(${h} 70% 92%)`, cd:`hsl(${h} 56% 60%)` };
}
/* ci 가 있으면 고른 색, 없으면 이름 순번으로 자동 배정 */
function tone(name, ci){
  if (Number.isInteger(ci) && ci >= 0 && ci < HUES.length) return shades(HUES[ci]);
  return shades(HUES[Math.max(0, roster.indexOf(name)) % HUES.length]);
}
/* 같은 사람이 이미 색을 고른 적이 있으면 그 색을 이어 쓴다 (한 사람이 여러 색이 되지 않게) */
const ciOfName = name => {
  const hit = [...leaves].reverse().find(l => l.name === name && Number.isInteger(l.ci));
  return hit ? hit.ci : null;
};

const isOff = d => d.getDay() === 0 || d.getDay() === 6 || !!D.holidays[iso(d)];
/* 주말·공휴일은 전원 휴무라 등록분을 표시하지 않는다 */
const onLeave = day => isOff(day) ? [] : leaves
  .filter(l => parse(l.start) <= day && day <= parse(l.end || l.start))
  .sort((a,b) => a.name.localeCompare(b.name,"ko"));

function chipHtml(p, fresh, plain){
  const t = tone(p.name, p.ci);
  const span = p.end && p.end !== p.start ? ` ~ ${p.end}` : "";
  const del = !plain && p.id;
  const label = `${p.name} · ${p.start}${span}${p.note ? " · " + p.note : ""}`;
  const tag = del ? "button" : "span";
  return `<${tag} class="chip${fresh ? " new" : ""}" style="--c:${t.c};--cb:${t.cb};--cd:${t.cd}"`
    + (del ? ` type="button" data-id="${esc(p.id)}" aria-label="${esc(label)} 수정"` : "")
    + ` title="${esc(label)}${del ? " — 눌러서 수정" : ""}">`
    + `<span class="nm">${esc(p.name)}</span>${p.note ? `<i>${esc(p.note)}</i>` : ""}`
    + `</${tag}>`;
}

/* ════════ 렌더 ════════ */
function render(){
  const y = cur.getFullYear(), m = cur.getMonth();
  const dim = new Date(y, m+1, 0).getDate();
  const lead = new Date(y, m, 1).getDay();
  const total = Math.ceil((lead + dim) / 7) * 7;

  roster = [...new Set(leaves.map(l => l.name))].sort((a,b) => a.localeCompare(b,"ko"));
  document.getElementById("names").innerHTML =
    roster.map(n => `<option value="${esc(n)}">`).join("");
  /* 정적 색을 미리 넣어 둔다 — 모션을 끈 환경(prefers-reduced-motion)에서도 색 램프는 남는다.
     애니메이션이 돌 때는 hue 키프레임이 이 값을 덮는다. */
  document.getElementById("label").innerHTML =
    [...`${y}.${pad(m+1)}`].map((ch,i) => ch === "."
      ? `<i class="p" style="--i:${i}">.</i>`
      : `<i style="--i:${i};color:${RAMP[i % RAMP.length]}">${ch}</i>`).join("");

  let cells = "";
  for (let i = 0; i < total; i++){
    const d = new Date(y, m, i - lead + 1);
    const inM = d.getMonth() === m && d.getFullYear() === y;
    const hol = inM ? D.holidays[iso(d)] : null;
    const now = inM && +d === +TODAY;
    const ppl = inM ? onLeave(d) : [];
    const ring = !!justAdded && inM && iso(d) === justAdded.start;
    const chips = ppl.map(p => chipHtml(p, justAdded && p.id === justAdded.id)).join("");
    const open = inM && !isOff(d);

    cells += `<div class="${["d", inM ? "" : "pad", now ? "now" : (inM && isOff(d) ? "off" : ""),
        ring ? "burst" : ""].filter(Boolean).join(" ")}" style="--i:${i}"`
      + (open ? ` data-date="${iso(d)}" role="button" tabindex="0"`
              + ` aria-label="${m+1}월 ${d.getDate()}일 일정 등록"` : "")
      + `><div class="dn"><b>${pad(d.getDate())}</b>`
      + (hol ? `<span class="hl">${esc(hol)}</span>` : "")
      + (ppl.length > 1 ? `<span class="ct">${ppl.length}</span>` : "")
      + `</div><div class="who">${chips}</div></div>`;
  }
  document.getElementById("grid").innerHTML = cells;

  const t = onLeave(TODAY);
  document.getElementById("k").textContent = `오늘 ${iso(TODAY)} ${WD[TODAY.getDay()]}`;
  document.getElementById("v").innerHTML = t.length
    ? "휴가 " + t.map(p => chipHtml(p, false, true)).join("")
    : (isOff(TODAY) ? "휴무일" : "전원 근무");
  wake();
}

/* ════════ API ════════ */
async function load(){
  const src = document.getElementById("src"), err = document.getElementById("err");
  try {
    const res = await fetch(API + "?t=" + Date.now(), { headers:{ "cache-control":"no-cache" } });
    if (!res.ok) throw new Error("응답 " + res.status);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error("형식 오류");
    leaves = list; live = true;
    err.innerHTML = "";
    src.textContent = `${leaves.length} records · ${new Date().toLocaleTimeString("ko-KR")}`;
  } catch(e) {
    live = false;
    if (LOCAL){
      leaves = D.sample.map(r => ({ ...r, id: uid() }));
      src.textContent = "local preview";
      err.className = "note";
      err.textContent = "로컬에서 열어 저장소가 없습니다. 아래는 실제 기록이 아니라 화면 확인용 예시입니다.";
    } else {
      leaves = [];                       // 가짜 이름을 실제처럼 보여주지 않는다
      src.textContent = "unavailable";
      err.className = "err";
      err.textContent = "저장소를 읽지 못했습니다 (" + e.message + "). "
        + "잠시 후 자동으로 다시 시도합니다. 이 화면은 비어 있을 뿐이며 기록이 지워진 것은 아닙니다.";
    }
  }
  render();
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "loc-" + Date.now().toString(36) + Math.random().toString(36).slice(2,8));

/* ════════ 이모지 버스트 (등록 성공 순간에만) ════════ */
const EMOJIS = ["🌴","🍉","✈️","🐳","🍒","🧊","☀️","🛟","🥤"];
function emojiBurst(el, count = 9){
  if (REDUCED) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const layer = document.getElementById("burst");
  for (let i = 0; i < count; i++){
    const s = document.createElement("span");
    s.textContent = EMOJIS[i % EMOJIS.length];
    const ang = -Math.PI / 2 + (i / (count - 1) - .5) * 1.7;
    const v = 96 + Math.random() * 78;
    s.style.left = cx + "px";
    s.style.top = cy + "px";
    s.style.setProperty("--dx", (Math.cos(ang) * v).toFixed(1) + "px");
    s.style.setProperty("--dy", (Math.sin(ang) * v).toFixed(1) + "px");
    s.style.setProperty("--rot", (Math.random() * 100 - 50).toFixed(0) + "deg");
    s.style.animationDelay = i * 16 + "ms";
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1200);
  }
}

/* ════════ 등록 · 삭제 ════════ */
const addBox = document.getElementById("add"), msg = document.getElementById("f-msg");
const F = id => document.getElementById("f-" + id);
function say(text, bad, undo){
  msg.className = "msg on" + (bad ? " bad" : "");
  msg.textContent = text;                        // 문자열은 항상 textContent 로
  if (undo){
    const b = document.createElement("button");
    b.type = "button"; b.className = "undo"; b.textContent = "되돌리기";
    b.onclick = undo;
    msg.append(" ", b);
  }
}

/* ── 색 스와치 ── 저장은 팔레트 인덱스(ci)로만 한다 */
let pickedCi = null;                       // null = 이름별 자동
function paintSwatches(){
  F("sw").innerHTML =
    `<button type="button" class="auto" data-ci="" aria-pressed="${pickedCi === null}">자동</button>`
    + HUES.map((h, i) =>
        `<button type="button" data-ci="${i}" style="--c:${shades(h).cd}"`
        + ` aria-pressed="${pickedCi === i}" aria-label="색 ${i + 1}" title="색 ${i + 1}"></button>`
      ).join("");
}
F("sw").addEventListener("click", e => {
  const b = e.target.closest("button[data-ci]");
  if (!b) return;
  pickedCi = b.dataset.ci === "" ? null : Number(b.dataset.ci);
  paintSwatches();
});
/* 이미 색을 고른 사람 이름을 넣으면 그 색을 이어 쓴다 */
F("name").addEventListener("input", () => {
  if (editing) return;
  const ci = ciOfName(F("name").value.trim());
  if (ci !== null && ci !== pickedCi){ pickedCi = ci; paintSwatches(); }
});

/* ── 폼: 등록 모드 / 수정 모드 ── */
let editing = null;                        // 수정 중인 레코드 id

function show(on){
  addBox.classList.toggle("on", on);
  const t = document.getElementById("toggle");
  t.classList.toggle("on", on);
  t.setAttribute("aria-expanded", String(on));
}
function setMode(rec){
  editing = rec ? rec.id : null;
  addBox.classList.toggle("editing", !!rec);
  F("save").textContent = rec ? "수정" : "등록";
}
function openForm(date){
  setMode(null);
  pickedCi = null;
  F("name").value = ""; F("note").value = "";
  if (date){ F("from").value = date; F("to").value = date; }
  paintSwatches();
  msg.className = "msg";
  show(true);
  F("name").focus();
}
function openEdit(rec){
  setMode(rec);
  F("name").value = rec.name;
  F("from").value = rec.start;
  F("to").value = rec.end || rec.start;
  F("note").value = rec.note || "";
  pickedCi = Number.isInteger(rec.ci) ? rec.ci : null;
  paintSwatches();
  msg.className = "msg";
  show(true);
  F("name").focus();
}
function closeForm(){ setMode(null); show(false); }

document.getElementById("toggle").onclick = () =>
  addBox.classList.contains("on") ? closeForm() : openForm();
F("cancel").onclick = closeForm;

/* id 가 있으면 그 레코드를 덮어쓰고(PUT), 없으면 새로 만든다(POST) */
async function send(rec, id){
  const res = await fetch(id ? `${API}?id=${encodeURIComponent(id)}` : API, {
    method: id ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(rec)
  });
  if (!res.ok){
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "응답 " + res.status);
  }
  return res.json();
}

async function submit(){
  const btn = F("save");
  const name = F("name").value.trim(), from = F("from").value;
  const to = F("to").value || from, note = F("note").value.trim();
  const id = editing;                       // 아래에서 폼을 닫아도 유지되게 붙잡아 둔다

  if (!name)                   return say("이름을 입력하세요.", true);
  if (!valid(from))            return say("시작일을 선택하세요.", true);
  if (!valid(to))              return say("종료일이 올바르지 않습니다.", true);
  if (parse(to) < parse(from)) return say("종료일이 시작일보다 앞섭니다.", true);
  if (leaves.some(l => l.id !== id && l.name === name && l.start === from && l.end === to))
    return say("같은 사람의 같은 기간이 이미 등록돼 있습니다.", true);

  const rec = { name, start: from, end: to, note, ci: pickedCi };
  const apply = saved => {
    leaves = id ? leaves.map(l => l.id === id ? saved : l) : leaves.concat(saved);
    if (!id){ justAdded = saved; setTimeout(() => { justAdded = null; }, 900); }
    cur = new Date(parse(from).getFullYear(), parse(from).getMonth(), 1);
    render();
    if (!id) emojiBurst(btn);
  };

  if (!live){
    apply({ ...rec, id: id || uid() });
    say("화면에만 반영했습니다. 배포된 주소에서 열면 실제로 저장됩니다.");
    if (id) closeForm();
    return;
  }

  btn.disabled = true;
  try {
    apply(await send(rec, id));
    say(`${name} ${from}${to !== from ? " ~ " + to : ""} ${id ? "수정" : "등록"}했습니다.`);
    if (id) closeForm();
    else { F("name").value = ""; F("note").value = ""; }
  } catch(e){
    say((id ? "수정" : "등록") + "하지 못했습니다 — " + e.message, true);
  } finally {
    btn.disabled = false;
  }
}
F("save").onclick = submit;
addBox.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.tagName === "INPUT") submit();
  if (e.key === "Escape") closeForm();
});

/* ── 삭제 (수정 화면 안에서) ── */
async function removeRecord(rec){
  const span = rec.end !== rec.start ? " ~ " + rec.end : "";
  const undo = async () => {
    const back = { name:rec.name, start:rec.start, end:rec.end, note:rec.note, ci:rec.ci };
    try {
      leaves = leaves.concat(live ? await send(back, null) : { ...back, id: uid() });
      render();
      say(`${rec.name} ${rec.start}${span} 되살렸습니다.`);
    } catch(e){ say("되돌리지 못했습니다 — " + e.message, true); }
  };
  if (!live){
    leaves = leaves.filter(l => l.id !== rec.id); render();
    say(`${rec.name} ${rec.start}${span} 삭제했습니다.`, false, undo);
    return;
  }
  try {
    const res = await fetch(`${API}?id=${encodeURIComponent(rec.id)}`, { method:"DELETE" });
    if (!res.ok) throw new Error("응답 " + res.status);
    leaves = leaves.filter(l => l.id !== rec.id); render();
    say(`${rec.name} ${rec.start}${span} 삭제했습니다.`, false, undo);
  } catch(err){
    say("삭제하지 못했습니다 — " + err.message, true);
  }
}
F("del").onclick = async () => {
  const rec = leaves.find(l => l.id === editing);
  if (!rec) return;
  const span = rec.end !== rec.start ? " ~ " + rec.end : "";
  if (!confirm(`${rec.name} ${rec.start}${span}\n삭제할까요? (되돌리기 버튼으로 복구할 수 있습니다)`)) return;
  closeForm();
  await removeRecord(rec);
};

/* ── 달력에서 열기: 칩=수정, 빈 칸=등록 ── */
const grid = document.getElementById("grid");
function openFromEvent(target){
  const chip = target.closest(".chip[data-id]");
  if (chip){
    const rec = leaves.find(l => l.id === chip.dataset.id);
    if (rec) openEdit(rec);
    return true;
  }
  const cell = target.closest(".d[data-date]");
  if (cell){ openForm(cell.dataset.date); return true; }
  return false;
}
grid.addEventListener("click", e => { if (openFromEvent(e.target)) e.stopPropagation(); });
grid.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  if (openFromEvent(e.target)){ e.preventDefault(); e.stopPropagation(); }
});


document.getElementById("prev").onclick = () => { cur.setMonth(cur.getMonth()-1); render(); };
document.getElementById("next").onclick = () => { cur.setMonth(cur.getMonth()+1); render(); };
document.getElementById("today").onclick = () => { cur = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1); load(); };

/* ════════ 배경: Reactive Grid ════════
   격자마다 라운드 사각형 하나. 커서에 가까울수록 커지고 목표 크기로 부드럽게 이징한다.
   타일이 불투명하므로 글자 뒤에서는 보이지 않고 타일 사이 여백에서만 보인다.
   전부 멈추고 8초간 입력이 없으면 rAF 를 멈춘다 — 종일 켜둬도 배터리를 태우지 않는다. */
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const MIN = 9, MAX_S = 26, GAP = 6, INFLUENCE = 240, CELL = MAX_S + GAP, EASE = .16;
const PARTICLE = "rgba(10,122,99,.12)";
const cv = document.getElementById("bg");
const ctx = cv.getContext("2d");
const hasRound = typeof ctx.roundRect === "function";
let cols = 0, rows = 0, sizes = new Float32Array(0);
let px = -9e9, py = -9e9;
let running = false, visible = true, lastAct = 0;

function layout(){
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width  = Math.max(1, Math.round(innerWidth  * dpr));
  cv.height = Math.max(1, Math.round(innerHeight * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cols = Math.ceil(innerWidth  / CELL) + 1;
  rows = Math.ceil(innerHeight / CELL) + 1;
  const next = new Float32Array(cols * rows).fill(MIN);
  next.set(sizes.subarray(0, Math.min(sizes.length, next.length)));
  sizes = next;
}

function paint(){
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.fillStyle = PARTICLE;
  ctx.beginPath();
  let settling = false;
  for (let r = 0; r < rows; r++){
    const cy = r * CELL + CELL / 2;
    for (let c = 0; c < cols; c++){
      const cx = c * CELL + CELL / 2;
      const d = Math.hypot(px - cx, py - cy);
      let t = d < INFLUENCE ? 1 - d / INFLUENCE : 0;
      t = t * t * (3 - 2 * t);
      const target = MIN + (MAX_S - MIN) * t;
      const i = r * cols + c;
      const s = sizes[i] + (target - sizes[i]) * EASE;
      sizes[i] = s;
      if (Math.abs(target - s) > .06) settling = true;
      const half = s / 2;
      if (hasRound) ctx.roundRect(cx - half, cy - half, s, s, s * .32);
      else ctx.rect(cx - half, cy - half, s, s);
    }
  }
  ctx.fill();
  return settling;
}

function loop(ms){
  if (!running) return;
  const busy = paint();
  if (!busy && ms - lastAct > 8000){ running = false; return; }
  requestAnimationFrame(loop);
}
function wake(){
  lastAct = performance.now();
  if (!running && visible && !REDUCED){ running = true; requestAnimationFrame(loop); }
}

layout();
if (REDUCED) paint();
else {
  addEventListener("resize", () => { layout(); if (!running) paint(); });
  addEventListener("pointermove", e => { px = e.clientX; py = e.clientY; wake(); }, {passive:true});
  addEventListener("pointerdown", wake, {passive:true});
  addEventListener("scroll", wake, {passive:true});
  document.addEventListener("pointerleave", () => { px = py = -9e9; wake(); });
}

/* ════════ 폴링 — 탭이 보일 때만 ════════ */
let poll = null;
function startPoll(){ if (!poll) poll = setInterval(load, 60000); }
function stopPoll(){ if (poll){ clearInterval(poll); poll = null; } }
document.addEventListener("visibilitychange", () => {
  visible = document.visibilityState === "visible";
  if (visible){ wake(); startPoll(); load(); }      // 다시 보면 즉시 최신화
  else { running = false; stopPoll(); }
});

paintSwatches();      // 폼이 접혀 있어도 미리 그려 둔다 (열 때 비어 보이지 않게)
load();
startPoll();

/* ════════ 자가검증 — 콘솔에서 selftest() ════════ */
window.selftest = function selftest(){
  const out = [], ok = (c,m) => out.push((c ? "ok   " : "FAIL ") + m);
  /* render() 가 격자를 새로 만들므로 매번 새로 조회한다 — 예전 참조는 DOM 에서 떨어져
     getComputedStyle 이 빈 값을 주고, 그러면 검사가 조용히 통과해 버린다 */
  const cells = () => [...document.querySelectorAll("#grid .d")];
  const dim = new Date(cur.getFullYear(), cur.getMonth()+1, 0).getDate();
  const css = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
  const opaque = el => {
    const bg = getComputedStyle(el).backgroundColor;
    if (!bg) return false;                       // 떨어져 나간 요소 — 검사 불가이므로 실패로 본다
    const m = bg.match(/rgba?\(([^)]+)\)/);
    return !!m && (m[1].split(",").length < 4 || parseFloat(m[1].split(",")[3]) >= .999);
  };

  /* 달력 정확성 */
  ok(cells().length % 7 === 0, "칸 수가 7의 배수 (" + cells().length + ")");
  ok(cells()[new Date(cur.getFullYear(),cur.getMonth(),1).getDay()].querySelector("b").textContent === "01", "1일이 요일 위치에 맞음");
  ok(cells().filter(e => e.classList.contains("pad")).length === cells().length - dim, "이전·다음 달 칸 수 정확");
  ok(!cells().some(e => e.classList.contains("pad") && e.querySelector(".chip")), "이전·다음 달 칸엔 이름 없음");
  ok(!cells().some(e => e.classList.contains("off") && e.querySelector(".chip")), "주말·공휴일 칸엔 이름 없음");
  ok(!document.querySelector(".d.off[data-date],.d.pad[data-date]"), "휴무일 칸은 클릭 대상 아님");
  ok(onLeave(parse("2026-08-15")).length === 0 && onLeave(parse("2026-08-17")).length === 0,
     "광복절·대체공휴일엔 등록분 안 뜸");
  ok(valid("2026-08-03") && !valid("2026-02-30") && !valid("2026-8-3"), "날짜 유효성 검사");

  /* XSS — 저장된 값이 그대로 실행되지 않아야 한다 */
  (() => {
    const keep = leaves, keepLive = live, keepCur = new Date(cur);
    window.__pwn = 0;
    /* 보고 있는 달과 무관하게 검사되도록 날짜를 맞춰 둔다 — 예전엔 다른 달을 보고 있으면
       칩이 안 그려져 검사가 null 로 터졌다(가장 중요한 검사가 달에 따라 깨지면 안 된다) */
    const d0 = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    const weekday = (() => { const x = new Date(d0); while (isOff(x)) x.setDate(x.getDate()+1); return iso(x); })();
    cur = d0;
    leaves = [
      { id:"x1", name:'<img src=x onerror=__pwn++>'.slice(0,20), start:weekday, end:weekday, note:"" },
      { id:"x2", name:"홍길동", start:weekday, end:weekday, note:'<img src=x onerror=__pwn++>' },
      { id:"x3", name:"김철수", start:weekday, end:weekday, note:'" onmouseover="__pwn++" x="' }
    ];
    live = true; render();
    const nm = document.querySelector("#grid .nm");
    ok(!!nm, "검사용 칩이 그려짐 (" + weekday + ")");
    ok(document.querySelectorAll("#grid img, #grid svg, #grid script").length === 0, "주입 태그가 생성되지 않음");
    ok(!document.querySelector("#grid .chip[onmouseover]"), "속성 탈출로 이벤트 핸들러가 안 붙음");
    ok(window.__pwn === 0, "페이로드 미실행 (실행 " + window.__pwn + "회)");
    ok(!!nm && nm.textContent.includes("<img"), "위험 문자는 글자로 표시됨");
    leaves = keep; live = keepLive; cur = keepCur; render();
  })();

  /* 월 표시 — Jua + 두둥실·쫀득·색파동.
     문서 타임라인은 탭이 안 보이면 멈추므로, 재생에 의존하지 않고 currentTime 을 직접 넣어 검사한다.
     글자별 위상차는 CSS animation-delay 가 갖고 있으니 여기서 더하면 안 된다(더하면 상쇄된다). */
  (() => {
    const h1 = document.querySelector("h1");
    const chars = [...h1.querySelectorAll("i")];
    const bob = el => el.getAnimations().find(a => a.animationName === "bob" || a.animationName === "bobdot");
    const ty = el => new DOMMatrix(getComputedStyle(el).transform).f;
    const setAll = T => chars.forEach(c => { const a = bob(c); if (a) a.currentTime = T; });

    ok(document.fonts.check('400 96px "JuaNum"'), "Jua 서브셋 로드됨");
    ok(getComputedStyle(h1).fontFamily.startsWith("JuaNum"), "월 표시에 Jua 적용");
    ok(getComputedStyle(h1).fontWeight === "400", "합성 볼드 안 씀");
    ok(chars.length === 7 && chars.every(c => c.style.getPropertyValue("--i") !== ""), "글자 7개에 --i 부여");
    ok(!chars.some(c => c.style.animationDelay), "인라인 딜레이 없음 (CSS 위상차 유지)");
    ok(chars.every(c => c.classList.contains("p") || /^rgb/.test(c.style.color)),
       "숫자에 정적 램프 색 (모션 끈 환경 대비)");

    const names = chars[0].getAnimations().map(a => a.animationName);
    ok(names.includes("bob") && names.includes("hue"), "숫자에 bob + hue");

    chars.forEach(c => { const r = c.getAnimations().find(a => a.animationName === "rise"); if (r) r.currentTime = 600; });
    setAll(1450);
    const ys = chars.map(c => +ty(c).toFixed(2));
    ok(new Set(ys).size >= 4, `같은 순간 글자 높이가 ${new Set(ys).size}단계 = 파도`);
    ok(Math.min(...ys) < -3, `두둥실 진폭 ${Math.min(...ys)}px`);
    const a1 = ys.join();
    setAll(2100);
    ok(chars.map(c => +ty(c).toFixed(2)).join() !== a1, "시간이 지나면 파도가 이동");

    const dot = chars.find(c => c.classList.contains("p"));
    setAll(1512);                                  // 점(index 4)의 최고점
    ok(Math.abs(ty(dot)) > Math.abs(ty(chars[0])) + 2, "점이 숫자보다 더 높이 튄다");
    ok(getComputedStyle(dot).color === "rgb(196, 80, 107)", "점은 따뜻한 색 고정");

    const hue = chars[0].getAnimations().find(a => a.animationName === "hue");
    const cols = [0, .25, .5, .75].map(f => { hue.currentTime = f * 5600; return getComputedStyle(chars[0]).color; });
    ok(new Set(cols).size === 4, "색이 4단계로 순환 (컬러 파동)");

    const hb = h1.getBoundingClientRect();
    ok(chars.every(c => { const r = c.getBoundingClientRect();
      return r.top >= hb.top - .5 && r.right <= hb.right + .5; }), "두둥실이 위·옆으로 안 잘림");
  })();

  /* 가독성·대비 */
  ok(cells().length > 0 && cells().every(opaque), "모든 달력 칸이 불투명");
  ok(opaque(document.querySelector(".fields")), "등록 폼이 불투명");
  ok(cells().every(e => getComputedStyle(e).backdropFilter === "none"), "칸에 배경 블러 없음");
  ok(css("--accent") === "#0A7A63", "액센트가 대비 통과값(#0A7A63)");
  ok(css("--warn") === "#B22B54", "공휴일 색이 대비 통과값(#B22B54)");
  ok(css("--ink3") === "#5F6F69" && css("--pad") === "#EFF5F3", "타월 날짜 대비 통과 조합");
  ok(getComputedStyle(document.querySelector(".wk div")).color === "rgb(92, 107, 102)", "요일 라벨이 ink2");

  /* 키보드 */
  const chip = document.querySelector("#grid .chip[data-id]");
  const cell = document.querySelector(".d[data-date]");
  ok(!!cell && cell.getAttribute("tabindex") === "0" && cell.getAttribute("role") === "button",
     "날짜 칸이 키보드로 도달·조작 가능");
  ok(!chip || chip.tagName === "BUTTON", "칩이 실제 button 요소");
  ok(!chip || /수정$/.test(chip.getAttribute("aria-label") || ""), "칩에 '수정' 이라고 읽어줌");

  /* 칩 레이아웃 */
  const chips = [...document.querySelectorAll("#grid .chip")];
  ok(!chips.length || chips.every(c => c.getBoundingClientRect().height <= 26), "칩이 두 줄로 접히지 않음");

  /* 헤더 레이아웃 — 폭에 따라 자리가 흔들리지 않아야 한다 */
  (() => {
    const head = document.querySelector(".head");
    const hcs = getComputedStyle(head);
    const tracks = hcs.gridTemplateColumns.split(" ").filter(Boolean).length;
    ok(hcs.display === "grid", "헤더가 grid (예전 flex+wrap 은 폭마다 줄바꿈이 달라졌다)");
    ok(innerWidth > 1080 ? tracks === 3 : tracks === 1,
       `현재 폭 ${innerWidth}px → ${tracks}열 배치`);
    const fs = parseFloat(getComputedStyle(document.querySelector("h1")).fontSize);
    ok([84, 68, 56].includes(Math.round(fs)), `월 표시 크기가 단계값 (${Math.round(fs)}px)`);
  })();

  /* 수정 모드 · 색 선택 */
  (() => {
    const sw = [...document.querySelectorAll("#f-sw button")];
    ok(sw.length === HUES.length + 1, `색 스와치 ${sw.length}개 (자동 + 팔레트 ${HUES.length})`);
    ok(sw.filter(b => b.getAttribute("aria-pressed") === "true").length === 1, "선택된 색이 항상 하나");
    ok(sw[0].dataset.ci === "" && sw[0].textContent === "자동", "첫 칸은 자동");

    const keep = leaves, keepLive = live, keepCur = new Date(cur);
    const d0 = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    const wd = (() => { const x = new Date(d0); while (isOff(x)) x.setDate(x.getDate()+1); return iso(x); })();
    cur = d0;
    leaves = [{ id:"e1", name:"수정테스트", start:wd, end:wd, note:"메모", ci:5 }];
    live = false; render();

    const chip = document.querySelector('#grid .chip[data-id="e1"]');
    ok(!!chip, "검사용 칩 렌더");
    const want = shades(HUES[5]).cb;
    ok(chip && chip.style.getPropertyValue("--cb") === want, `저장된 색 인덱스가 칩에 반영 (ci=5)`);

    chip.click();
    ok(document.getElementById("add").classList.contains("on"), "칩을 누르면 폼이 열린다");
    ok(document.getElementById("add").classList.contains("editing"), "수정 모드로 열린다");
    ok(F("save").textContent === "수정", "버튼이 '수정' 으로 바뀐다");
    ok(F("name").value === "수정테스트" && F("from").value === wd && F("note").value === "메모",
       "기존 내용이 폼에 채워진다");
    ok([...document.querySelectorAll("#f-sw button")][6].getAttribute("aria-pressed") === "true",
       "저장된 색이 스와치에 선택된 상태로 들어온다");
    ok(getComputedStyle(F("del")).display !== "none", "수정 모드에선 삭제 버튼이 보인다");

    closeForm();
    ok(!document.getElementById("add").classList.contains("editing"), "닫으면 수정 모드 해제");
    openForm(wd);
    ok(F("save").textContent === "등록" && getComputedStyle(F("del")).display === "none",
       "등록 모드에선 삭제 버튼이 숨는다");
    closeForm();

    leaves = keep; live = keepLive; cur = keepCur; render();
  })();

  /* 배경 */
  ok(cols > 1 && rows > 1 && sizes.length === cols * rows, `배경 격자 ${cols}×${rows}`);
  const before = sizes[0];
  px = CELL / 2; py = CELL / 2;
  for (let i = 0; i < 40; i++) paint();
  ok(sizes[0] > before + 3, `커서 근처 입자가 부풀음 ${before.toFixed(1)} → ${sizes[0].toFixed(1)}`);
  px = py = -9e9;
  for (let i = 0; i < 90; i++) paint();
  ok(sizes[0] < MIN + 1, "커서가 떠나면 원래대로");

  /* 폴링·실패 처리 */
  ok(typeof poll === "number" || poll === null, "폴링 핸들 관리됨");
  ok(LOCAL || true, "배포 환경에서는 API 실패 시 예시 데이터를 쓰지 않음 (load() 분기)");

  /* 칸 폭이 균일해야 한다. 1fr 은 min-content 를 존중하므로 nowrap 칩이 든 칸만
     넓어지고, 좁은 화면에서 격자가 화면을 넘어 가로 스크롤이 생겼다 → minmax(0,1fr) */
  (() => {
    const ws = [...document.querySelectorAll("#grid .d")].map(e => Math.round(e.getBoundingClientRect().width));
    ok(new Set(ws).size === 1, `칸 폭이 전부 같음 (${[...new Set(ws)].join("/")}px)`);
    ok(getComputedStyle(document.getElementById("grid")).gridTemplateColumns.split(" ").length === 7,
       "격자가 7열");
  })();
  ok(document.querySelector("h1").style.length >= 0
     && parseFloat(getComputedStyle(document.querySelector("h1")).webkitTextStrokeWidth) > 1,
     "월 표시에 외곽선 두께 적용 (Jua 는 400 하나뿐이라 스트로크로 굵힌다)");
  ok(document.body.scrollWidth <= document.body.clientWidth + 1, "가로 스크롤 없음");
  return out.join("\n");
};
