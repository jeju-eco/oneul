/* 순수 로직 테스트 — node tests/core.test.js */
'use strict';
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'core.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

console.log('[검색 키]');
t('정규화는 공백·기호를 지움', () => {
  assert.strictEqual(C.norm(' 송악산(절울이) '), '송악산절울이');
});
t('초성 추출', () => {
  assert.strictEqual(C.chosung('국수'), 'ㄱㅅ');
  assert.strictEqual(C.chosung('백약이오름'), 'ㅂㅇㅇㅇㄹ');
});
t('초성 질의 판정', () => {
  assert.ok(C.isChosungQuery('ㄱㅅ'));
  assert.ok(!C.isChosungQuery('국수'));
  assert.ok(!C.isChosungQuery(''));
});

console.log('\n[음력]');
t('2026-09-11은 음력 8월 1일', () => {
  const l = C.lunar(new Date('2026-09-11T12:00:00+09:00'));
  assert.strictEqual(l.day, 1, JSON.stringify(l));
});
t('2026-09-24는 음력 14일', () => {
  assert.strictEqual(C.lunar(new Date('2026-09-24T12:00:00+09:00')).day, 14);
});
t('2026-10-10은 음력 9월 1일', () => {
  const l = C.lunar(new Date('2026-10-10T12:00:00+09:00'));
  assert.strictEqual(l.day, 1);
  assert.strictEqual(l.month, 9);
});

console.log('\n[물때 — 8물때식]');
t('음력 1일은 8물', () => assert.strictEqual(C.multtae(1), '8물'));
t('음력 8일은 조금', () => assert.strictEqual(C.multtae(8), '조금'));
t('음력 9일은 1물', () => assert.strictEqual(C.multtae(9), '1물'));
t('음력 15일은 7물', () => assert.strictEqual(C.multtae(15), '7물'));
t('음력 16일은 다시 8물', () => assert.strictEqual(C.multtae(16), '8물'));
t('음력 23일은 조금', () => assert.strictEqual(C.multtae(23), '조금'));
t('음력 30일은 7물', () => assert.strictEqual(C.multtae(30), '7물'));
t('표 전체가 15일 주기로 반복', () => {
  for (let d = 1; d <= 15; d++) assert.strictEqual(C.multtae(d + 15), C.multtae(d), '음력 ' + d);
});
t('범위 밖은 빈 문자열', () => {
  assert.strictEqual(C.multtae(0), '');
  assert.strictEqual(C.multtae(31), '');
  assert.strictEqual(C.multtae('x'), '');
});
t('조금이 가장 약하고 물수가 클수록 셈', () => {
  assert.strictEqual(C.multtaeStrength('조금'), 0);
  assert.ok(C.multtaeStrength('14물') > C.multtaeStrength('7물'));
  assert.ok(C.multtaeStrength('7물') > C.multtaeStrength('1물'));
});

console.log('\n[달]');
t('음력 1일은 어둡다', () => assert.ok(C.moonIllum(1) < 0.02, String(C.moonIllum(1))));
t('음력 15일은 밝다', () => assert.ok(C.moonIllum(15) > 0.95, String(C.moonIllum(15))));
t('음력 8일은 반달 근처', () => {
  const v = C.moonIllum(8);
  assert.ok(v > 0.35 && v < 0.65, String(v));
});
t('이름이 붙는다', () => {
  assert.strictEqual(C.moonLabel(C.moonIllum(1)), '삭');
  assert.strictEqual(C.moonLabel(C.moonIllum(15)), '보름');
});

console.log('\n[조위 극값]');
// 실제 Open-Meteo 응답 모양: 정시 간격 시계열
const times = [], heights = [];
for (let i = 0; i < 48; i++) {
  const h = String(i % 24).padStart(2, '0');
  const day = i < 24 ? '24' : '25';
  times.push(`2026-09-${day}T${h}:00`);
  // 반일주조 + 일주조 섞은 합성파 (주기 12.42h)
  heights.push(Math.round((1.2 * Math.sin((2 * Math.PI * i) / 12.42) + 0.2 * Math.sin((2 * Math.PI * i) / 24)) * 100) / 100);
}
const ext = C.tideExtremes(times, heights);

t('하루 반나절에 고조·저조가 번갈아 나온다', () => {
  assert.ok(ext.length >= 6, '극값 ' + ext.length + '개');
  for (let i = 1; i < ext.length; i++) {
    assert.notStrictEqual(ext[i].type, ext[i - 1].type, '연속 같은 타입: ' + JSON.stringify(ext.slice(i - 1, i + 1)));
  }
});
t('고조는 저조보다 높다', () => {
  const hi = ext.filter((e) => e.type === 'high').map((e) => e.h);
  const lo = ext.filter((e) => e.type === 'low').map((e) => e.h);
  assert.ok(Math.min(...hi) > Math.max(...lo), `hi:${hi} lo:${lo}`);
});
t('극값 간격이 6시간 안팎', () => {
  for (let i = 1; i < ext.length; i++) {
    const gap = (ext[i].at - ext[i - 1].at) / 3600000;
    assert.ok(gap > 4 && gap < 9, `간격 ${gap.toFixed(1)}h`);
  }
});
t('보간으로 정시가 아닌 시각도 나온다', () => {
  assert.ok(ext.some((e) => !e.t.endsWith(':00')), ext.map((e) => e.t).join(','));
});
t('시각 표기가 HH:MM', () => {
  ext.forEach((e) => assert.ok(/^\d{2}:\d{2}$/.test(e.t), e.t));
});
t('null이 섞여도 죽지 않는다', () => {
  const h2 = heights.slice(); h2[5] = null; h2[6] = null;
  const r = C.tideExtremes(times, h2);
  assert.ok(Array.isArray(r) && r.length > 0);
});
t('자료가 짧으면 빈 배열', () => {
  assert.deepStrictEqual(C.tideExtremes(['2026-09-24T00:00'], [1]), []);
  assert.deepStrictEqual(C.tideExtremes(null, null), []);
});
t('다음 물때는 기준시각 이후 가장 가까운 것', () => {
  const now = new Date('2026-09-24T05:00:00');
  const n = C.nextTide(ext, now);
  assert.ok(n, '없음');
  assert.ok(n.at >= now, n.t);
  const earlier = ext.filter((e) => e.at >= now).sort((a, b) => a.at - b.at)[0];
  assert.strictEqual(n.t, earlier.t);
});
t('모두 지난 시각이면 null', () => {
  assert.strictEqual(C.nextTide(ext, new Date('2026-09-30T00:00:00')), null);
});
t('localStorage를 거쳐 Date가 문자열이 돼도 동작한다', () => {
  // 앱을 껐다 켜면 저장된 날씨가 JSON에서 되살아난다. at이 문자열이 된다.
  const revived = JSON.parse(JSON.stringify(ext));
  assert.strictEqual(typeof revived[0].at, 'string', '전제 확인: at이 문자열이어야 함');
  const now = new Date('2026-09-24T05:00:00');
  const n = C.nextTide(revived, now);
  assert.ok(n, 'null이 나옴 — 저장분을 못 읽음');
  assert.ok(n.at instanceof Date, 'at이 Date가 아님: ' + typeof n.at);
  assert.strictEqual(n.t, C.nextTide(ext, now).t, '원본과 다른 결과');
});
t('at이 깨져 있어도 죽지 않는다', () => {
  const junk = [{ iso: 'x', t: '99:99', h: 0, type: 'low', at: '말도안되는값' }];
  assert.doesNotThrow(() => C.nextTide(junk, new Date()));
  assert.strictEqual(C.nextTide(junk, new Date()), null);
});
t('빈 목록·null도 안전', () => {
  assert.strictEqual(C.nextTide([], new Date()), null);
  assert.strictEqual(C.nextTide(null, new Date()), null);
});

console.log('\n[나들이 점수]');
t('맑고 바람 없으면 만점', () => {
  const r = C.hourScore({ rain: 0, wind: 2, cloud: 10, temp: 22 });
  assert.strictEqual(r.score, 5, JSON.stringify(r));
});
t('비 올 확률 높으면 크게 깎임', () => {
  const r = C.hourScore({ rain: 80, wind: 2, cloud: 90, temp: 22 });
  assert.ok(r.score <= 2, String(r.score));
  assert.ok(r.why.some((w) => w.includes('비')), r.why.join(','));
});
t('바람이 세면 깎이고, 강풍은 더 깎인다', () => {
  const calm = C.hourScore({ rain: 0, wind: 2, cloud: 10, temp: 22 }).score;
  const mid = C.hourScore({ rain: 0, wind: 8, cloud: 10, temp: 22 }).score;
  const strong = C.hourScore({ rain: 0, wind: 14, cloud: 10, temp: 22 }).score;
  assert.ok(mid < calm, `중풍 ${mid} >= 잔잔 ${calm}`);
  assert.ok(strong < mid, `강풍 ${strong} >= 중풍 ${mid}`);
  assert.ok(calm - strong >= 2, `강풍 감점이 너무 작음: ${calm} -> ${strong}`);
});
t('폭염·한파는 깎임', () => {
  assert.ok(C.hourScore({ rain: 0, wind: 2, cloud: 0, temp: 35 }).score < 4);
  assert.ok(C.hourScore({ rain: 0, wind: 2, cloud: 0, temp: -2 }).score < 4);
});
t('점수는 0~5를 벗어나지 않는다', () => {
  const worst = C.hourScore({ rain: 100, wind: 25, cloud: 100, temp: 40 });
  assert.ok(worst.score >= 0, String(worst.score));
  assert.ok(C.hourScore({ rain: 0, wind: 0, cloud: 0, temp: 20 }).score <= 5);
});

console.log('\n[하루 판정]');
const mkHours = (spec) => spec.map((s, i) => ({
  time: `2026-09-24T${String(i).padStart(2, '0')}:00`,
  rain: s[0], wind: s[1], cloud: s[2], temp: s[3],
}));
t('오전 비 오후 갬 → 오후부터 좋다고 알려준다', () => {
  const hrs = mkHours(Array.from({ length: 24 }, (_, i) =>
    i < 13 ? [90, 8, 100, 20] : [0, 2, 10, 23]));
  const v = C.dayVerdict(hrs);
  assert.ok(v.bestFrom >= '13:00', v.bestFrom);
  assert.ok(v.bestScore > v.score, `best ${v.bestScore} <= overall ${v.score}`);
});
t('종일 맑으면 최고', () => {
  const v = C.dayVerdict(mkHours(Array.from({ length: 24 }, () => [0, 2, 5, 22])));
  assert.strictEqual(v.score, 5);
  assert.strictEqual(v.label, '최고');
});
t('종일 폭우면 낮다', () => {
  const v = C.dayVerdict(mkHours(Array.from({ length: 24 }, () => [95, 14, 100, 18])));
  assert.ok(v.score <= 1.5, String(v.score));
});
t('밤 시간은 판정에서 뺀다', () => {
  // 새벽만 맑고 낮엔 폭우 → 좋다고 하면 안 된다
  const hrs = mkHours(Array.from({ length: 24 }, (_, i) =>
    i < 7 ? [0, 1, 0, 20] : [95, 14, 100, 18]));
  const v = C.dayVerdict(hrs);
  assert.ok(v.score <= 2, String(v.score));
});
t('자료가 없으면 0점', () => {
  assert.strictEqual(C.dayVerdict([]).score, 0);
});
t('낮 대부분이 바람 강하면 최고라고 하지 않는다', () => {
  // 실제로 겪은 사례: 08~14시 강풍, 15시 이후 잔잔
  const hrs = mkHours(Array.from({ length: 24 }, (_, i) => {
    const wind = [9, 10.3, 12.8, 14.6, 14, 12.5, 10, 8, 4.8, 3.3, 1, 4][i - 8];
    return [0, wind == null ? 3 : wind, 60, 22];
  }));
  const v = C.dayVerdict(hrs);
  assert.ok(v.score <= 3.5, `점수 ${v.score} (${v.label}) — 바람 부는 날인데 너무 높음`);
  assert.notStrictEqual(v.label, '최고');
});
t('몇 시간만 좋아도 하루 전체가 최고가 되지 않는다', () => {
  // 1시간만 만점, 나머지는 폭우
  const hrs = mkHours(Array.from({ length: 24 }, (_, i) =>
    (i === 15 ? [0, 1, 0, 22] : [95, 12, 100, 20])));
  const v = C.dayVerdict(hrs);
  assert.ok(v.score <= 1.5, `${v.score} (${v.label})`);
  assert.strictEqual(v.bestScore, 5, '최고 시각은 따로 알려줘야 한다');
});
t('오후에 확실히 좋아지면 그 시각을 알려준다', () => {
  const hrs = mkHours(Array.from({ length: 24 }, (_, i) =>
    (i < 14 ? [90, 10, 100, 20] : [0, 2, 10, 23])));
  const v = C.dayVerdict(hrs);
  assert.strictEqual(v.bestFrom, '14:00', String(v.bestFrom));
});
t('종일 같으면 좋아지는 시각을 말하지 않는다', () => {
  const v = C.dayVerdict(mkHours(Array.from({ length: 24 }, () => [0, 2, 10, 22])));
  assert.strictEqual(v.bestFrom, null, String(v.bestFrom));
});
t('이유는 나쁜 시간대에서 뽑는다', () => {
  const hrs = mkHours(Array.from({ length: 24 }, (_, i) =>
    (i < 16 ? [0, 13, 20, 22] : [0, 1, 10, 22])));
  const v = C.dayVerdict(hrs);
  assert.ok(v.why.some((w) => w.includes('바람')), v.why.join(','));
});
t('라벨이 점수와 맞는다', () => {
  assert.strictEqual(C.SCORE_LABEL[5], '최고');
  assert.strictEqual(C.SCORE_LABEL[0], '별로');
});
t('애매한 점수는 낮은 쪽 라벨을 쓴다', () => {
  // 낮 절반이 강풍인 날: 3.5점이 나오는데 '아주 좋음'이라고 하면 안 된다
  const hrs = mkHours(Array.from({ length: 24 }, (_, i) => {
    const w = [9, 10.3, 12.8, 14.6, 14, 12.5, 10, 8, 4.8, 3.3, 1, 4][i - 8];
    return [0, w == null ? 3 : w, 60, 22];
  }));
  const v = C.dayVerdict(hrs);
  assert.strictEqual(v.score, 3.5, String(v.score));
  assert.strictEqual(v.label, '좋음', `${v.score}점인데 '${v.label}'`);
});
t('정수 점수는 그대로 그 라벨', () => {
  const good = C.dayVerdict(mkHours(Array.from({ length: 24 }, () => [0, 2, 5, 22])));
  assert.strictEqual(good.score, 5);
  assert.strictEqual(good.label, '최고');
});

console.log('\n[거리]');
t('같은 점은 0m', () => assert.strictEqual(C.distance(33.5, 126.5, 33.5, 126.5), 0));
t('제주시–서귀포 약 28km', () => {
  const d = C.distance(33.4996, 126.5312, 33.2541, 126.5601);
  assert.ok(d > 26000 && d < 30000, String(d));
});
t('표고는 정수로 표기한다', () => {
  assert.strictEqual(C.altLabel(200.5), '201m');
  assert.strictEqual(C.altLabel(106.5), '107m');
  assert.strictEqual(C.altLabel(104), '104m');
  assert.strictEqual(C.altLabel(null), '');
  assert.strictEqual(C.altLabel(undefined), '');
});
t('거리 표기', () => {
  assert.strictEqual(C.distLabel(850), '850m');
  assert.strictEqual(C.distLabel(2500), '2.5km');
  assert.strictEqual(C.distLabel(28000), '28km');
});

console.log('\n[장소 검색]');
const oreumData = require(path.join(__dirname, '..', 'data', 'oreum.json'));
const db = {
  oreum: oreumData.oreum,
  visits: [
    C.makeVisit({ kind: 'food', name: '고기국수집', lat: 33.5, lon: 126.5, now: new Date('2026-09-01T12:00:00') }),
    C.makeVisit({ kind: 'food', name: '고기국수집', lat: 33.5, lon: 126.5, now: new Date('2026-09-10T12:00:00') }),
    C.makeVisit({ kind: 'oreum', name: '송악산(절울이)', oreumId: 1, lat: 33.199409, lon: 126.29078, now: new Date('2026-09-05T10:00:00') }),
  ],
};
t('오름 68개가 실려 있다', () => {
  assert.strictEqual(oreumData.oreum.length, 68);
  assert.ok(oreumData.oreum.every((o) => o.lat > 33 && o.lat < 33.7), '좌표 범위 이상');
});
t('원본에 표고가 없는 곳(둘레길)은 0m라고 쓰지 않는다', () => {
  assert.strictEqual(C.altLabel(0), '');
  const flat = oreumData.oreum.filter((o) => !o.alt);
  assert.ok(flat.length >= 1, '표고 0인 항목이 없어 검증 불가');
  flat.forEach((o) => assert.strictEqual(C.altLabel(o.alt), '', o.n));
});
t('표고 없는 곳에 낮음 딱지를 붙이지 않는다', () => {
  const r = C.suggest({ oreum: oreumData.oreum, visits: [] }, null, { now: new Date() }, 68);
  r.filter((x) => !x.alt).forEach((x) => {
    assert.ok(!(x.why || []).includes('낮음'), x.name + ': ' + (x.why || []).join(','));
  });
});
t('내 기록이 먼저 나온다', () => {
  const r = C.searchPlaces(db, '국수');
  assert.ok(r.length > 0);
  assert.strictEqual(r[0].name, '고기국수집');
  assert.strictEqual(r[0].mine, true);
});
t('같은 점수면 내 기록이 오름을 제친다', () => {
  // '물영아리'라는 이름의 식당을 기록해두면, 같은 이름 오름보다 앞에 와야 한다
  const db2 = {
    oreum: oreumData.oreum,
    visits: [C.makeVisit({ kind: 'food', name: '물영아리', lat: 33.5, lon: 126.5 })],
  };
  const r = C.searchPlaces(db2, '물영아리');
  const mineIdx = r.findIndex((x) => x.mine);
  const oreumIdx = r.findIndex((x) => !x.mine && x.name.includes('물영아리'));
  assert.ok(mineIdx >= 0, '내 기록이 결과에 없음');
  assert.ok(oreumIdx >= 0, '오름이 결과에 없음');
  assert.ok(mineIdx < oreumIdx, `내 기록 ${mineIdx} 위치가 오름 ${oreumIdx}보다 뒤`);
});
t('같은 곳 두 번 가면 한 줄에 2회로 합쳐진다', () => {
  const r = C.searchPlaces(db, '국수');
  assert.strictEqual(r[0].count, 2, JSON.stringify(r[0]));
  assert.strictEqual(r[0].last, '2026-09-10');
});
t('초성으로 내 기록을 찾는다', () => {
  const r = C.searchPlaces(db, 'ㄱㄱㄱㅅ');
  assert.ok(r.some((x) => x.name === '고기국수집'), JSON.stringify(r.slice(0, 3)));
});
t('오름도 초성으로 찾힌다', () => {
  const r = C.searchPlaces(db, 'ㅁㅇㅇㄹ');
  assert.ok(r.some((x) => x.name.includes('물영아리')), r.map((x) => x.name).join(','));
});
t('초성 경로를 거쳐야만 찾히는 것도 찾는다', () => {
  // 'ㅁㅇㅇㄹ'은 norm() 부분포함으로는 어떤 오름 이름과도 안 맞는다.
  // 초성 매칭이 꺼지면 결과가 0이어야 한다.
  const r = C.searchPlaces({ oreum: oreumData.oreum, visits: [] }, 'ㅁㅇㅇㄹ');
  assert.ok(r.length > 0, '초성 검색이 동작하지 않음');
  const plain = oreumData.oreum.filter((o) => C.norm(o.n).includes(C.norm('ㅁㅇㅇㄹ')));
  assert.strictEqual(plain.length, 0, '부분포함으로도 찾히므로 초성 검증이 안 됨');
});
t('초성 접두가 부분포함보다 앞에 온다', () => {
  // 'ㅅㅅ' → 접두: 식산봉(바우오름, 9자) / 포함: 거린사슴(4자)
  // 길이만으로 정렬하면 짧은 '거린사슴'이 이긴다. 접두 가산점이 있어야 뒤집힌다.
  const r = C.searchPlaces({ oreum: oreumData.oreum, visits: [] }, 'ㅅㅅ');
  const names = r.map((x) => x.name);
  const pre = names.findIndex((n) => n.startsWith('식산봉'));
  const inc = names.indexOf('거린사슴');
  assert.ok(pre >= 0, '초성 접두 결과가 없음: ' + names.join(','));
  assert.ok(inc >= 0, '초성 포함 결과가 없음: ' + names.join(','));
  assert.ok(pre < inc, `접두 식산봉(${pre})이 포함 거린사슴(${inc})보다 뒤에 있음`);
});
t('이미 간 오름은 미방문 목록에 또 안 나온다', () => {
  const r = C.searchPlaces(db, '송악');
  const same = r.filter((x) => x.name === '송악산(절울이)');
  assert.strictEqual(same.length, 1, JSON.stringify(same));
  assert.strictEqual(same[0].mine, true);
});
t('안 간 오름은 mine=false', () => {
  const r = C.searchPlaces(db, '물영아리');
  assert.strictEqual(r[0].mine, false);
  assert.ok(r[0].oreumId);
});
t('빈 질의는 빈 결과', () => {
  assert.deepStrictEqual(C.searchPlaces(db, ''), []);
  assert.deepStrictEqual(C.searchPlaces(db, '   '), []);
});
t('없는 이름은 빈 결과', () => {
  assert.deepStrictEqual(C.searchPlaces(db, '엉터리이름xyz'), []);
});

console.log('\n[추천]');
t('안 가본 오름만 추천한다', () => {
  const r = C.suggest(db, { lat: 33.2, lon: 126.29 }, { now: new Date() }, 5);
  assert.ok(!r.some((x) => x.oreumId === 1), '간 곳이 추천됨');
});
t('가까운 순으로 나온다', () => {
  const r = C.suggest(db, { lat: 33.4996, lon: 126.5312 }, { now: new Date() }, 5);
  const ds = r.filter((x) => x.dist != null).map((x) => x.dist);
  assert.deepStrictEqual(ds, ds.slice().sort((a, b) => a - b), String(ds));
});
t('위치를 모르면 이름순', () => {
  const r = C.suggest(db, null, { now: new Date() }, 5);
  assert.strictEqual(r.length, 5);
  assert.ok(r.every((x) => x.dist === null));
});
t('간조 전후 2시간이면 바다를 맨 위에 올린다', () => {
  const now = new Date('2026-09-24T14:00:00');
  const r = C.suggest(db, null, { now: now, lowTide: new Date('2026-09-24T15:00:00') }, 5);
  assert.strictEqual(r[0].kind, 'sea', JSON.stringify(r[0]));
  assert.ok(r[0].why[0].includes('15:00'), r[0].why.join(','));
});
t('간조가 멀면 바다를 안 올린다', () => {
  const now = new Date('2026-09-24T08:00:00');
  const r = C.suggest(db, null, { now: now, lowTide: new Date('2026-09-24T15:00:00') }, 5);
  assert.notStrictEqual(r[0].kind, 'sea');
});

console.log('\n[기록]');
t('기록을 만들면 날짜·시각·id가 붙는다', () => {
  const v = C.makeVisit({ kind: 'food', name: '밀면집', now: new Date('2026-09-24T13:05:00') });
  assert.strictEqual(v.date, '2026-09-24');
  assert.strictEqual(v.time, '13:05');
  assert.ok(v.id);
  assert.strictEqual(v.kind, 'food');
});
t('이름 앞뒤 공백을 지운다', () => {
  assert.strictEqual(C.makeVisit({ name: '  밀면집  ' }).name, '밀면집');
});
t('좌표 없으면 null', () => {
  const v = C.makeVisit({ name: 'x' });
  assert.strictEqual(v.lat, null);
  assert.strictEqual(v.oreumId, null);
});
t('id가 겹치지 않는다', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(C.newId());
  assert.strictEqual(ids.size, 500);
});
t('집계가 맞는다', () => {
  const s = C.summarize(db.visits);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.byKind.food, 2);
  assert.strictEqual(s.byKind.oreum, 1);
  assert.strictEqual(s.oreumDone, 1);
});
t('같은 오름 두 번 가도 정복 수는 1', () => {
  const vs = db.visits.concat([C.makeVisit({ kind: 'oreum', name: '송악산(절울이)', oreumId: 1 })]);
  assert.strictEqual(C.summarize(vs).oreumDone, 1);
});
t('빈 목록도 안전', () => {
  assert.strictEqual(C.summarize([]).total, 0);
  assert.strictEqual(C.summarize(null).total, 0);
});

console.log('\n[CSV 내보내기]');
t('헤더 + 행 수가 맞는다', () => {
  const csv = C.toCSV(db.visits);
  const lines = csv.replace('\ufeff', '').split(String.fromCharCode(13, 10));
  assert.strictEqual(lines.length, 4, String(lines.length));
  assert.ok(lines[0].startsWith('날짜,시각,종류'), lines[0]);
});
t('날짜순으로 정렬된다', () => {
  const lines = C.toCSV(db.visits).replace('\ufeff', '').split(String.fromCharCode(13, 10));
  assert.ok(lines[1].startsWith('2026-09-01'), lines[1]);
  assert.ok(lines[3].startsWith('2026-09-10'), lines[3]);
});
t('쉼표 든 이름을 따옴표로 감싼다', () => {
  const csv = C.toCSV([C.makeVisit({ name: '국수, 그집', kind: 'food' })]);
  assert.ok(csv.includes('"국수, 그집"'), csv);
});
t('BOM이 붙어 엑셀에서 한글이 깨지지 않는다', () => {
  assert.ok(C.toCSV([]).startsWith('\ufeff'));
});

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
