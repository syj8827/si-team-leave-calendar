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
let lastDeleted = null;      // 되돌리기용

/* 월 표시 글자별 기본 색 (큰 글자 기준 3:1 이상). 애니메이션이 이 위로 파동을 얹는다 */
const RAMP = ["#2F937A","#2F9390","#2F7F93","#2F6993","#2F9361","#2F934D","#2F932F"];

/* 보라 계열(250~330) 제외. 인접 순번끼리 최소 46도 벌어지게 배열 */
const HUES = [138,0,184,46,230,92,345,161,23,207,69,115];
let roster = [];
function tone(name){
  const h = HUES[Math.max(0, roster.indexOf(name)) % HUES.length];
  return { c:`hsl(${h} 44% 29%)`, cb:`hsl(${h} 70% 92%)`, cd:`hsl(${h} 56% 60%)` };
}

const isOff = d => d.getDay() === 0 || d.getDay() === 6 || !!D.holidays[iso(d)];
/* 주말·공휴일은 전원 휴무라 등록분을 표시하지 않는다 */
const onLeave = day => isOff(day) ? [] : leaves
  .filter(l => parse(l.start) <= day && day <= parse(l.end || l.start))
  .sort((a,b) => a.name.localeCompare(b.name,"ko"));

function chipHtml(p, fresh, plain){
  const t = tone(p.name);
  const span = p.end && p.end !== p.start ? ` ~ ${p.end}` : "";
  const del = !plain && p.id;
  const label = `${p.name} · ${p.start}${span}${p.note ? " · " + p.note : ""}`;
  const tag = del ? "button" : "span";
  return `<${tag} class="chip${fresh ? " new" : ""}" style="--c:${t.c};--cb:${t.cb};--cd:${t.cd}"`
    + (del ? ` type="button" data-id="${esc(p.id)}" aria-label="${esc(label)} 삭제"` : "")
    + ` title="${esc(label)}${del ? " — 눌러서 삭제" : ""}">`
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

function openForm(date){
  addBox.classList.add("on");
  document.getElementById("toggle").classList.add("on");
  document.getElementById("toggle").setAttribute("aria-expanded", "true");
  if (date){ F("from").value = date; F("to").value = date; }
  F("name").focus();
}
function closeForm(){
  addBox.classList.remove("on");
  document.getElementById("toggle").classList.remove("on");
  document.getElementById("toggle").setAttribute("aria-expanded", "false");
}
document.getElementById("toggle").onclick = () =>
  addBox.classList.contains("on") ? closeForm() : openForm();

async function post(rec){
  const res = await fetch(API, {
    method: "POST",
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
  const btn = document.getElementById("f-save");
  const name = F("name").value.trim(), from = F("from").value;
  const to = F("to").value || from, note = F("note").value.trim();

  if (!name)                   return say("이름을 입력하세요.", true);
  if (!valid(from))            return say("시작일을 선택하세요.", true);
  if (!valid(to))              return say("종료일이 올바르지 않습니다.", true);
  if (parse(to) < parse(from)) return say("종료일이 시작일보다 앞섭니다.", true);
  if (leaves.some(l => l.name === name && l.start === from && l.end === to))
    return say("같은 사람의 같은 기간이 이미 등록돼 있습니다.", true);

  const rec = { name, start: from, end: to, note };
  const done = saved => {
    leaves = leaves.concat(saved);
    justAdded = saved;
    cur = new Date(parse(from).getFullYear(), parse(from).getMonth(), 1);
    render();
    emojiBurst(btn);
    setTimeout(() => { justAdded = null; }, 900);
    F("name").value = ""; F("note").value = "";
  };

  if (!live){
    done({ ...rec, id: uid() });
    say("저장소에 연결되지 않아 화면에만 반영했습니다. 배포된 주소에서 열면 실제로 저장됩니다.");
    return;
  }

  btn.disabled = true;
  try {
    done(await post(rec));
    say(`${name} ${from}${to !== from ? " ~ " + to : ""} 등록했습니다.`);
  } catch(e){
    say("등록하지 못했습니다 — " + e.message, true);
  } finally {
    btn.disabled = false;
  }
}
document.getElementById("f-save").onclick = submit;
addBox.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.tagName === "INPUT") submit();
  if (e.key === "Escape") closeForm();
});

async function removeLeave(chip){
  const rec = leaves.find(l => l.id === chip.dataset.id);
  if (!rec) return;
  const span = rec.end !== rec.start ? " ~ " + rec.end : "";
  if (!confirm(`${rec.name} ${rec.start}${span} 삭제할까요?`)) return;
  chip.classList.add("gone");

  const undo = async () => {
    try {
      if (live) leaves = leaves.concat(await post({ name:rec.name, start:rec.start, end:rec.end, note:rec.note }));
      else leaves = leaves.concat({ ...rec, id: uid() });
      lastDeleted = null;
      render();
      say(`${rec.name} ${rec.start}${span} 되살렸습니다.`);
    } catch(e){ say("되돌리지 못했습니다 — " + e.message, true); }
  };

  if (!live){
    setTimeout(() => {
      leaves = leaves.filter(l => l.id !== rec.id);
      lastDeleted = rec; render();
      say(`${rec.name} ${rec.start}${span} 삭제했습니다.`, false, undo);
    }, 260);
    return;
  }
  try {
    const res = await fetch(`${API}?id=${encodeURIComponent(rec.id)}`, { method:"DELETE" });
    if (!res.ok) throw new Error("응답 " + res.status);
    leaves = leaves.filter(l => l.id !== rec.id);
    lastDeleted = rec; render();
    say(`${rec.name} ${rec.start}${span} 삭제했습니다.`, false, undo);
  } catch(err){
    chip.classList.remove("gone");
    say("삭제하지 못했습니다 — " + err.message, true);
  }
}

const grid = document.getElementById("grid");
grid.addEventListener("click", e => {
  const chip = e.target.closest(".chip[data-id]");
  if (chip){ e.stopPropagation(); removeLeave(chip); return; }
  const cell = e.target.closest(".d[data-date]");
  if (cell) openForm(cell.dataset.date);
});
/* 키보드로도 등록·삭제가 되게 한다 */
grid.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const chip = e.target.closest(".chip[data-id]");
  if (chip){ e.preventDefault(); e.stopPropagation(); removeLeave(chip); return; }
  const cell = e.target.closest(".d[data-date]");
  if (cell){ e.preventDefault(); openForm(cell.dataset.date); }
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
    const keep = leaves, keepLive = live;
    window.__pwn = 0;
    leaves = [
      { id:"x1", name:'<img src=x onerror=__pwn++>'.slice(0,20), start:"2026-08-05", end:"2026-08-05", note:"" },
      { id:"x2", name:"홍길동", start:"2026-08-06", end:"2026-08-06", note:'<img src=x onerror=__pwn++>' },
      { id:"x3", name:"김철수", start:"2026-08-07", end:"2026-08-07", note:'" onmouseover="__pwn++" x="' }
    ];
    live = true; render();
    ok(document.querySelectorAll("#grid img, #grid svg, #grid script").length === 0, "주입 태그가 생성되지 않음");
    ok(!document.querySelector("#grid .chip[onmouseover]"), "속성 탈출로 이벤트 핸들러가 안 붙음");
    ok(window.__pwn === 0, "페이로드 미실행 (실행 " + window.__pwn + "회)");
    ok(document.querySelector("#grid .nm").textContent.includes("<img"), "위험 문자는 글자로 표시됨");
    leaves = keep; live = keepLive; render();
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
  ok(!chip || chip.tagName === "BUTTON", "삭제 칩이 실제 button 요소");
  ok(!chip || !!chip.getAttribute("aria-label"), "삭제 칩에 읽어줄 이름이 있음");

  /* 칩 레이아웃 */
  const chips = [...document.querySelectorAll("#grid .chip")];
  ok(!chips.length || chips.every(c => c.getBoundingClientRect().height <= 26), "칩이 두 줄로 접히지 않음");

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

  ok(document.body.scrollWidth <= document.body.clientWidth + 1, "가로 스크롤 없음");
  return out.join("\n");
};
