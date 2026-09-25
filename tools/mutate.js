/* 테스트가 진짜인지 확인한다 — node tools/mutate.js
 * 일부러 버그를 심고 테스트가 잡는지 본다. 하나라도 안 잡히면 실패다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const MUTATIONS = [
  // ─── core.js ───
  ['core.js', '물때 주기를 14일로', 'const idx = (d - 1) % 15;', 'const idx = (d - 1) % 14;'],
  ['core.js', '조금을 빼먹음', "'14물','조금',", "'14물','15물',"],
  ['core.js', '고조/저조 뒤집기', 'const isHigh = b > a && b >= c;', 'const isHigh = b < a && b <= c;'],
  ['core.js', '극값 보간 제거', 'const off = denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denom));', 'const off = 0;'],
  ['core.js', '비 확률 무시', 'if (rain >= 60) { s -= 3;', 'if (rain >= 600) { s -= 3;'],
  ['core.js', '바람 무시', 'if (wind >= 10) { s -= 2;', 'if (wind >= 100) { s -= 2;'],
  ['core.js', '밤 시간도 판정에 포함', 'const from = opt.from == null ? 8 : opt.from;', 'const from = opt.from == null ? 0 : opt.from;'],
  ['core.js', '내 기록 가산점 제거', 'hits.push({ r: r + 5, p: p });', 'hits.push({ r: r - 50, p: p });'],
  ['core.js', '간 오름도 다시 추천', 'if (visited.has(String(o.i))) return;', 'if (false) return;'],
  ['core.js', '거리 정렬 뒤집기', 'return a.dist - b.dist;', 'return b.dist - a.dist;'],
  ['core.js', 'CSV 따옴표 제거', 'return /[",\\r\\n]/.test(s) ? \'"\' + s.replace(/"/g, \'""\') + \'"\' : s;', 'return s;'],
  ['core.js', 'CSV BOM 제거', "return '\\ufeff' + lines.join(CRLF);", 'return lines.join(CRLF);'],
  ['core.js', '같은 장소 합치기 실패', 'cur.count += 1;', 'cur.count += 0;'],
  ['core.js', '초성 검색 끄기', 'if (useCho && chosung(name).startsWith(qc)) return 70;', 'if (false) return 70;'],
  ['core.js', '이름 공백 안 지움', "name: (input.name || '').trim(),", 'name: input.name || \'\','],
  ['core.js', '같은 오름 중복 집계', 'if (v.oreumId != null) oreumSet.add(String(v.oreumId));', 'if (v.oreumId != null) oreumSet.add(String(v.oreumId) + Math.random());'],

  // ─── app.js ───
  ['app.js', '저장을 안 함', 'localStorage.setItem(KEY, JSON.stringify(S));', 'void 0;'],
  ['app.js', '이름 없이도 저장', "if (!name) { $('sHint').textContent = '이름을 적어주세요'; $('sName').focus(); return; }", 'if (false) { return; }'],
  ['app.js', '날씨 스냅샷 안 박음', 'const v = C.makeVisit(Object.assign({}, draft, { snap: snapNow() }));', 'const v = C.makeVisit(Object.assign({}, draft));'],
  ['app.js', '되돌리기 제거', 'showUndo(`${gone.name} 지웠습니다`, () => {', 'if (false) showUndo(`${gone.name} 지웠습니다`, () => {'],
  ['app.js', '오름 눌러도 이름 안 채움', "if (o) openSheet({ kind: 'oreum', name: o.n, oreumId: o.i, lat: o.lat, lon: o.lon });", "if (o) openSheet({ kind: 'oreum', oreumId: o.i, lat: o.lat, lon: o.lon });"],
  ['app.js', '날짜를 오늘로 안 채움', "date: init.date || C.todayStr(),", "date: init.date || '',"],
  ['app.js', '오프라인 안내 없음', "$('vLabel').textContent = '날씨 못 받음';", "$('vLabel').textContent = '좋음';"],
  ['app.js', '안 간 오름 정렬 뒤집기', 'if (da !== db2) return da ? 1 : -1;', 'if (da !== db2) return da ? -1 : 1;'],
  ['app.js', '검색 중 통계 안 숨김', "$('logStats').hidden = true;", "$('logStats').hidden = false;"],
  ['app.js', '깨진 저장분에 안 죽음 해제', 'if (p && Array.isArray(p.visits)) S = p;', 'S = p;'],
  ['core.js', '저장된 조석 Date 복원 제거', '.map(reviveTide)', '.map((x) => x)'],
  ['app.js', '캐시 날씨 Date 복원 제거', 'p.data.tides = (p.data.tides || []).map(C.reviveTide).filter(Boolean);', 'void 0;'],
  ['core.js', '표고 0을 0m로 표기', 'return v == null || !Number.isFinite(n) || n <= 0 ? \'\' : Math.round(n) + \'m\';', "return v == null ? '' : Math.round(n) + 'm';"],
  ['core.js', '하루 점수를 최고점으로', 'const overall = Math.round(Math.min(mid, avg) * 2) / 2;', 'const overall = Math.round(Math.max(...sortedScores) * 2) / 2;'],
  ['core.js', '라벨을 올림으로', 'label: SCORE_LABEL[Math.floor(overall)] || SCORE_LABEL[0],', 'label: SCORE_LABEL[Math.ceil(overall)] || SCORE_LABEL[0],'],
  ['app.js', '지도를 전체에 안 맞춤', 'map.fitBounds(L.latLngBounds(pts).pad(0.08));', 'void pts;'],
  ['app.js', '파고 칩을 항상 표시', 'if (w && w.wave != null && w.wave >= 1)', 'if (w && w.wave != null)'],
  ['core.js', '지도 묶음 해제 (마커 떡짐)', 'if (Math.hypot(c.x - p.x, c.y - p.y) <= R) { hit = c; break; }', 'if (false) { hit = c; break; }'],
  ['core.js', '묶음 중심을 평균 안 냄', 'hit.x = hit.items.reduce((s, q) => s + q.x, 0) / hit.items.length;', 'void 0;'],
  ['app.js', '고치기 표시 제거', '<span class="rt edit" aria-hidden="true">고치기 ›</span>', ''],
  ['app.js', '첫 안내 항상 표시', "const hint = list.length <= 3", "const hint = list.length <= 99999"],
  ['core.js', 'id를 난수로 (같은 ms 충돌)', "return Date.now().toString(36) + '-' + (idSeq++).toString(36);", "return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);"],
];

const TESTS = ['tests/core.test.js', 'tests/ui.test.js'];

function runTests() {
  for (const t of TESTS) {
    try {
      execFileSync(process.execPath, [t], { cwd: ROOT, stdio: 'pipe', timeout: 120000 });
    } catch (e) {
      return { green: false, by: t };
    }
  }
  return { green: true };
}

console.log('먼저 원본이 통과하는지 확인합니다…');
const base = runTests();
if (!base.green) {
  console.log(`원본이 이미 실패합니다 (${base.by}). 먼저 고치세요.`);
  process.exit(1);
}
console.log('원본 통과. 뮤테이션을 시작합니다.\n');

const originals = {};
['core.js', 'app.js'].forEach((f) => { originals[f] = fs.readFileSync(path.join(ROOT, f), 'utf8'); });

let caught = 0;
const missed = [];
for (const [file, name, from, to] of MUTATIONS) {
  const src = originals[file];
  if (!src.includes(from)) {
    missed.push(`${name} — 대상 코드를 못 찾음 (뮤테이션 정의가 낡음)`);
    console.log(`  ?    ${name}`);
    continue;
  }
  fs.writeFileSync(path.join(ROOT, file), src.replace(from, to));
  const r = runTests();
  fs.writeFileSync(path.join(ROOT, file), src);
  if (r.green) {
    missed.push(`${name} — 테스트가 못 잡음`);
    console.log(`  ✗    ${name}`);
  } else {
    caught++;
    console.log(`  잡힘 ${name}  (${r.by})`);
  }
}

console.log(`\n검출 ${caught}/${MUTATIONS.length}`);
missed.forEach((m) => console.log('  ✗ ' + m));

const after = runTests();
console.log('원복 확인:', after.green ? '통과' : '실패 — 원본이 깨졌습니다!');
process.exit(missed.length || !after.green ? 1 : 0);
