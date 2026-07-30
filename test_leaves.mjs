import fs from "fs";
// import 만 스텁으로 바꿔서 모듈 전체를 그대로 불러온다 (검사 로직을 다시 쓰지 않는다)
const src = fs.readFileSync("netlify/functions/leaves.mjs","utf8")
  .replace('import { getStore } from "@netlify/blobs";', 'const getStore = () => ({});');
const { clean, isDate } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
let bad = 0;
const ok = (c,m) => { console.log((c?"ok   ":"FAIL ")+m); if(!c) bad++; };

ok(isDate("2026-08-03"), "정상 날짜");
ok(!isDate("2026-02-30"), "2월 30일 거부");
ok(!isDate("2026-8-3"), "한자리 월일 거부");
ok(!isDate("2026-13-01"), "13월 거부");
ok(!isDate(""), "빈값 거부");

ok(clean({name:"김민준",start:"2026-08-10",end:"2026-08-14"}) !== null, "정상 등록 통과");
ok(clean({name:"김민준",start:"2026-08-10"})?.end === "2026-08-10", "종료일 생략 시 시작일로");
ok(clean({name:"  강하윤  ",start:"2026-08-06"})?.name === "강하윤", "이름 앞뒤 공백 제거");
ok(clean({name:"",start:"2026-08-10"}) === null, "이름 없으면 거부");
ok(clean({name:"ㄱ".repeat(21),start:"2026-08-10"}) === null, "이름 20자 초과 거부");
ok(clean({name:"A",start:"2026-08-10",note:"ㄴ".repeat(41)}) === null, "메모 40자 초과 거부");
ok(clean({name:"A",start:"2026-08-14",end:"2026-08-10"}) === null, "종료일 역전 거부");
ok(clean({name:"A",start:"2026-01-01",end:"2027-06-01"}) === null, "1년 초과 거부");
ok(clean({name:"A",start:"2026-02-30"}) === null, "없는 날짜 거부");
ok(clean(null) === null && clean("x") === null, "객체 아니면 거부");
ok(typeof clean({name:"A",start:"2026-08-10"}).id === "string", "id 발급");
ok(clean({name:"A",start:"2026-08-10"}).id !== clean({name:"A",start:"2026-08-10"}).id, "id 중복 없음");
ok(clean({name:"A",start:"2026-08-10"}).note === "", "메모 없으면 빈 문자열");

// 제어문자·제로폭·양방향 제어 문자 제거 (저장된 값이 화면에서 깨지는 것 방지)
ok(clean({name:"홍\t길\n동",start:"2026-08-01"})?.name === "홍길동", "탭·개행 제거");
ok(clean({name:"홍​길동",start:"2026-08-01"})?.name === "홍길동", "제로폭 문자 제거");
ok(clean({name:"홍‮길동",start:"2026-08-01"})?.name === "홍길동", "양방향 제어문자 제거");
ok(clean({name:"\t\n ",start:"2026-08-01"}) === null, "공백·제어문자만이면 거부");

// 날짜 상한 (9999년 등록으로 목록을 어지럽히는 것 방지)
ok(!isDate("2019-12-31"), "2020년 미만 거부");
ok(!isDate("2101-01-01"), "2100년 초과 거부");
ok(isDate("2020-01-01") && isDate("2100-12-31"), "허용 범위 경계 통과");

// 태그 문자열은 저장을 막지 않는다 — 사람 이름에 쓸 수도 있고, 방어는 출력 이스케이프가 한다
ok(clean({name:"<b>홍길동</b>",start:"2026-08-01"})?.name === "<b>홍길동</b>", "태그 문자는 그대로 저장");

console.log(bad ? `\n${bad}건 실패` : "\n전부 통과");
process.exit(bad ? 1 : 0);
