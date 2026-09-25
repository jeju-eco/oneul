/* 화면·저장·흐름 테스트 — node tests/ui.test.js
 * jsdom으로 index.html을 띄우고 app.js를 실제로 돌린다.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const oreumData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'oreum.json'), 'utf8'));

/* 시계를 2026-09-24 13:00로 고정한다 (물때·판정이 날짜에 좌우되므로) */
const FIXED = new Date('2026-09-24T13:00:00+09:00');

function makeWx(dayScore) {
  // dayScore: 'good' | 'bad'
  const hours = [];
  for (let d = 0; d < 2; d++) {
    for (let i = 0; i < 24; i++) {
      const date = d === 0 ? '2026-09-24' : '2026-09-25';
      hours.push({
        time: `${date}T${String(i).padStart(2, '0')}:00`,
        temp: 22, wind: dayScore === 'bad' ? 14 : 2,
        rain: dayScore === 'bad' ? 95 : 0,
        cloud: dayScore === 'bad' ? 100 : 10,
      });
    }
  }
  const mkT = (h, m, type, height) => {
    const at = new Date(`2026-09-24T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`);
    return { iso: `2026-09-24T${String(h).padStart(2, '0')}:00`, t: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, h: height, type, at };
  };
  return {
    lat: 33.5, lon: 126.53, at: Date.now(), hours,
    tides: [mkT(8, 10, 'high', 1.4), mkT(14, 20, 'low', -0.3), mkT(20, 30, 'high', 1.2)],
    wave: 0.6, sunrise: '2026-09-24T06:23', sunset: '2026-09-24T18:28',
  };
}

async function boot(opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  try { global.navigator = window.navigator; }
  catch (e) { Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true }); }

  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message || String(e.error)));

  // 시계 고정
  const RealDate = window.Date;
  function FakeDate(...args) {
    if (!args.length) return new RealDate(FIXED.getTime());
    return new RealDate(...args);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => FIXED.getTime();
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  window.Date = FakeDate;

  // 바깥 세계 차단
  // 최소한의 가짜 Leaflet — 타일은 못 그리지만 '무엇을 시켰는지'는 기록한다.
  // 이게 없으면 지도 관련 코드가 통째로 안 돌아 버그를 놓친다.
  window.__fitCalls = [];
  window.__markers = [];
  const bounds = (pts) => {
    const la = pts.map((p) => (Array.isArray(p) ? p[0] : p.lat));
    const lo = pts.map((p) => (Array.isArray(p) ? p[1] : p.lng));
    const b = {
      south: Math.min(...la), north: Math.max(...la),
      west: Math.min(...lo), east: Math.max(...lo),
      pad(f) {
        const dy = (this.north - this.south) * f, dx = (this.east - this.west) * f;
        return Object.assign({}, this, {
          south: this.south - dy, north: this.north + dy,
          west: this.west - dx, east: this.east + dx, pad: this.pad,
        });
      },
    };
    return b;
  };
  const chain = () => {
    const o = {
      addTo() { return o; }, bindPopup() { return o; }, bindTooltip() { return o; },
      on() { return o; }, remove() { return o; }, setLatLng() { return o; },
    };
    return o;
  };
  window.L = {
    map: () => {
      const m = {
        setView() { return m; }, on() { return m; }, remove() { return m; },
        addLayer() { return m; }, removeLayer() { return m; },
        getZoom: () => 10, getCenter: () => ({ lat: 33.38, lng: 126.55 }),
        latLngToContainerPoint: (ll) => {
          const la = Array.isArray(ll) ? ll[0] : ll.lat, lo = Array.isArray(ll) ? ll[1] : ll.lng;
          return { x: (lo - 126.1) * 900, y: (33.6 - la) * 900 };
        },
        containerPointToLatLng: (p) => ({ lat: 33.6 - p.y / 900, lng: 126.1 + p.x / 900 }),
        fitBounds: (b) => { window.__fitCalls.push(b); return m; },
      };
      return m;
    },
    tileLayer: Object.assign(() => ({ addTo: () => ({}) }), {}),
    TileLayer: { extend: () => function () { return { addTo: () => ({}) }; } },
    Util: { setOptions: () => {} },
    DomUtil: { create: (t) => window.document.createElement(t) },
    layerGroup: () => {
      const g = {
        addTo: () => g, clearLayers() { window.__markers.length = 0; return g; },
        removeLayer: () => g, addLayer: () => g,
      };
      return g;
    },
    marker: (ll) => { window.__markers.push(ll); return chain(); },
    divIcon: (o) => o,
    point: (x, y) => ({ x: x, y: y }),
    latLngBounds: bounds,
    Browser: { mobile: true },
  };
  window.indexedDB = undefined;
  window.navigator.vibrate = () => true;
  const geo = opts.geo === undefined ? { lat: 33.4996, lon: 126.5312 } : opts.geo;
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok, err) => {
        if (geo) setTimeout(() => ok({ coords: { latitude: geo.lat, longitude: geo.lon } }), 0);
        else setTimeout(() => err({ message: '거부됨' }), 0);
      },
    },
  });
  const downloads = [];
  window.URL.createObjectURL = (b) => { downloads.push(b); return 'blob:x'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { this.__clicked = true; };

  const fetched = [];
  window.fetch = (u) => {
    fetched.push(String(u));
    if (String(u).includes('oreum.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(oreumData) });
    }
    if (opts.offline) return Promise.reject(new Error('오프라인'));
    if (String(u).includes('marine-api')) {
      const times = [], slh = [];
      for (let i = 0; i < 48; i++) {
        const day = i < 24 ? '24' : '25';
        times.push(`2026-09-${day}T${String(i % 24).padStart(2, '0')}:00`);
        slh.push(Math.round(1.2 * Math.sin((2 * Math.PI * i) / 12.42) * 100) / 100);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ hourly: { time: times, sea_level_height_msl: slh, wave_height: times.map(() => 0.6) } }) });
    }
    // 날씨
    const time = [], temp = [], rain = [], wind = [], cloud = [];
    for (let d = 0; d < 2; d++) {
      for (let i = 0; i < 24; i++) {
        time.push(`2026-09-${d === 0 ? '24' : '25'}T${String(i).padStart(2, '0')}:00`);
        const bad = opts.weather === 'bad';
        temp.push(22); rain.push(bad ? 95 : 0); wind.push(bad ? 14 : 2); cloud.push(bad ? 100 : 10);
      }
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        hourly: { time, temperature_2m: temp, precipitation_probability: rain, wind_speed_10m: wind, cloud_cover: cloud },
        daily: { sunrise: ['2026-09-24T06:23'], sunset: ['2026-09-24T18:28'] },
      }),
    });
  };

  // 매 boot는 깨끗한 저장소에서 시작한다 (테스트 간 오염 방지)
  window.localStorage.clear();
  if (opts.seed) {
    window.localStorage.setItem('oneul_state',
      typeof opts.seed === 'string' ? opts.seed : JSON.stringify(opts.seed));
  }
  if (opts.wxCache) window.localStorage.setItem('oneul_wx', opts.wxCache);

  window.eval(fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
  await sleep(opts.wait || 250);
  return { window, doc: window.document, errors, fetched, downloads,
           $: (id) => window.document.getElementById(id),
           app: window.ONApp, C: window.ONCore,
           state: () => JSON.parse(window.localStorage.getItem('oneul_state') || 'null') };
}

(async () => {
  /* ═══════ 첫 실행 ═══════ */
  console.log('[첫 실행]');
  let e = await boot({});

  t('스크립트 오류가 없다', () => assert.deepStrictEqual(e.errors, []));
  t('오름 목록을 읽어온다', () => assert.strictEqual(e.app.oreum.length, 68));
  t('날씨를 받아온다', () => {
    assert.ok(e.app.wx, '날씨 없음');
    assert.strictEqual(e.app.wx.hours.length, 48);
  });
  t('조석 극값이 계산된다', () => assert.ok(e.app.wx.tides.length >= 6, String(e.app.wx.tides.length)));
  t('오늘 판정이 화면에 뜬다', () => {
    assert.strictEqual(e.$('vLabel').textContent, '최고', e.$('vLabel').textContent);
    assert.ok(e.$('verdict').className.includes('good'), e.$('verdict').className);
  });
  t('날짜와 음력이 맞다', () => {
    assert.strictEqual(e.$('vDate').textContent, '9/24 목', e.$('vDate').textContent);
    assert.strictEqual(e.$('vLunar').textContent, '음 8.14', e.$('vLunar').textContent);
  });
  t('물때가 6물로 표시된다 (음력 14일, 8물때식)', () => {
    assert.ok(e.$('vFacts').textContent.includes('6물'), e.$('vFacts').textContent);
  });
  t('다음 물때 시각이 나온다', () => {
    assert.ok(/\d{2}:\d{2}/.test(e.$('vFacts').textContent), e.$('vFacts').textContent);
  });
  t('일몰이 나온다', () => assert.ok(e.$('vFacts').textContent.includes('18:28'), e.$('vFacts').textContent));
  t('칩이 한 줄에 들어가게 3개를 넘지 않는다 (파고 잔잔할 때)', () => {
    const n = e.doc.querySelectorAll('#vFacts span').length;
    assert.ok(n <= 3, `칩 ${n}개: ${e.$('vFacts').textContent}`);
  });
  t('파고가 잔잔하면 파고 칩을 안 띄운다', () => {
    assert.ok(!e.$('vFacts').textContent.includes('파고'), e.$('vFacts').textContent);
  });
  t('점 5개로 점수를 보여준다', () => {
    const d = e.$('vDots').textContent;
    assert.strictEqual(d.length, 5, d);
    assert.strictEqual(d, '●●●●●', d);
  });
  t('기록이 없으면 안내가 뜬다', () => {
    assert.ok(e.$('logList').textContent.includes('아직 기록이 없습니다'), e.$('logList').textContent);
  });
  t('추천이 채워진다', () => {
    assert.ok(e.$('suggest').textContent.includes('오늘 어디 갈까'), e.$('suggest').textContent.slice(0, 80));
    assert.ok(e.doc.querySelectorAll('#suggest .item').length >= 3);
  });
  t('오름 정복도가 0/68로 시작', () => {
    assert.ok(e.$('oreumStats').textContent.includes('0 / 68'), e.$('oreumStats').textContent);
  });
  t('오름 68개가 목록에 다 있다', () => {
    assert.strictEqual(e.doc.querySelectorAll('#oreumList .item').length, 68);
  });
  t('지도를 오름 전체 범위에 맞춘다', () => {
    // 가짜 Leaflet이 기록한 fitBounds 호출을 실제로 확인한다.
    const calls = e.window.__fitCalls || [];
    assert.ok(calls.length > 0, 'fitBounds가 한 번도 안 불림 — 지도가 오름 전체를 안 잡는다');
    const last = calls[calls.length - 1];
    const lats = e.app.oreum.map((o) => o.lat);
    const lons = e.app.oreum.map((o) => o.lon);
    // 맞춘 범위 안에 모든 오름이 들어와야 한다
    assert.ok(last.south <= Math.min(...lats) + 1e-9, `남쪽이 잘림 ${last.south} > ${Math.min(...lats)}`);
    assert.ok(last.north >= Math.max(...lats) - 1e-9, `북쪽이 잘림 ${last.north} < ${Math.max(...lats)}`);
    assert.ok(last.west <= Math.min(...lons) + 1e-9, `서쪽이 잘림 ${last.west} > ${Math.min(...lons)}`);
    assert.ok(last.east >= Math.max(...lons) - 1e-9, `동쪽이 잘림 ${last.east} < ${Math.max(...lons)}`);
  });
  t('겹치는 오름은 묶어서 마커 수를 줄인다', () => {
    // 69개를 그대로 찍으면 폰 화면에서 떡진다. 묶어서 그려야 한다.
    const drawn = e.window.__markers.length;
    assert.ok(drawn > 0, '마커가 하나도 없음');
    assert.ok(drawn < e.app.oreum.length,
      `묶이지 않음 — 오름 ${e.app.oreum.length}개에 마커 ${drawn}개`);
  });
  t('묶어도 오름이 사라지지는 않는다', () => {
    // 화면에 그린 묶음들의 개수 합이 전체 오름 수와 같아야 한다
    const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    assert.ok(/clusterByPixel\(pts, \d+\)/.test(src), '묶음 호출이 없음');
    const pts = e.app.oreum.map((o) => {
      const p = { x: (o.lon - 126.1) * 900, y: (33.6 - o.lat) * 900 };
      return p;
    });
    const px = Number(src.match(/clusterByPixel\(pts, (\d+)\)/)[1]);
    const cl = e.C.clusterByPixel(pts, px);
    const sum = cl.reduce((s, c) => s + c.items.length, 0);
    assert.strictEqual(sum, e.app.oreum.length, '묶는 과정에서 오름이 사라짐');
  });
  t('제주 전체가 한 화면에 들어오는 범위다', () => {
    const lats = e.app.oreum.map((o) => o.lat);
    const lons = e.app.oreum.map((o) => o.lon);
    const span = Math.max(...lats) - Math.min(...lats);
    const spanLon = Math.max(...lons) - Math.min(...lons);
    assert.ok(span > 0.15, '위도 범위가 너무 좁음: ' + span);
    assert.ok(spanLon > 0.5, '경도 범위가 너무 좁음: ' + spanLon);
  });
  t('위치를 받으면 거리가 붙는다', () => {
    const rt = e.doc.querySelector('#oreumList .item .rt').textContent;
    assert.ok(/km|m$/.test(rt), '거리 없음: ' + rt);
  });

  /* ═══════ 날씨 나쁜 날 ═══════ */
  console.log('\n[날씨 나쁜 날]');
  let b = await boot({ weather: 'bad' });
  t('폭우면 낮은 점수', () => {
    assert.ok(b.$('verdict').className.includes('bad'), b.$('verdict').className);
    assert.ok(['별로', '아쉬움'].includes(b.$('vLabel').textContent), b.$('vLabel').textContent);
  });
  t('이유를 알려준다', () => {
    const w = b.$('vWhy').textContent;
    assert.ok(w.includes('비') || w.includes('바람'), w);
  });

  /* ═══════ 기록 남기기 ═══════ */
  console.log('\n[＋다녀옴]');
  e = await boot({});
  e.$('fab').click();
  await sleep(30);

  t('버튼을 누르면 시트가 열린다', () => assert.strictEqual(e.$('sheet').hidden, false));
  t('날짜가 오늘로 채워져 있다', () => assert.strictEqual(e.$('sDate').value, '2026-09-24'));
  t('현재 위치가 미리 들어가 있다', () => {
    assert.ok(e.$('sGeo').textContent.includes('33.4'), e.$('sGeo').textContent);
  });
  t('종류 버튼 4개', () => assert.strictEqual(e.doc.querySelectorAll('#kindPick button').length, 4));

  t('이름 없이 저장하면 막고 알려준다', () => {
    e.$('sSave').click();
    assert.strictEqual(e.$('sheet').hidden, false, '시트가 닫힘');
    assert.ok(e.$('sHint').textContent.includes('이름'), e.$('sHint').textContent);
    assert.strictEqual((e.state() || { visits: [] }).visits.length, 0);
  });

  e.doc.querySelector('#kindPick button[data-kind="food"]').click();
  t('종류를 누르면 켜진다', () => {
    assert.ok(e.doc.querySelector('#kindPick button[data-kind="food"]').classList.contains('on'));
    assert.strictEqual(e.app.draft.kind, 'food');
  });

  e.$('sName').value = '고기국수집';
  e.$('sNote').value = '멸치육수';
  e.$('sSave').click();
  await sleep(30);

  t('저장하면 시트가 닫힌다', () => assert.strictEqual(e.$('sheet').hidden, true));
  t('저장 버튼 없이 바로 localStorage에 들어간다', () => {
    const s = e.state();
    assert.ok(s, '저장 안 됨');
    assert.strictEqual(s.visits.length, 1);
    assert.strictEqual(s.visits[0].name, '고기국수집');
    assert.strictEqual(s.visits[0].kind, 'food');
    assert.strictEqual(s.visits[0].note, '멸치육수');
  });
  t('그때 날씨·물때가 같이 박힌다', () => {
    const v = e.state().visits[0];
    assert.ok(v.snap, 'snap 없음');
    assert.strictEqual(v.snap.multtae, '6물', JSON.stringify(v.snap));
    assert.strictEqual(v.snap.temp, 22);
    assert.ok(v.snap.tide && /\d{2}:\d{2}/.test(v.snap.tide), String(v.snap.tide));
  });
  t('시각이 기록된다', () => assert.strictEqual(e.state().visits[0].time, '13:00'));
  t('목록에 바로 보인다', () => {
    assert.ok(e.$('logList').textContent.includes('고기국수집'), e.$('logList').textContent);
    assert.ok(e.$('logStats').textContent.includes('1번 기록'), e.$('logStats').textContent);
  });

  /* ═══════ 오름 체크 ═══════ */
  console.log('\n[오름 다녀옴]');
  const firstOreum = e.doc.querySelector('#oreumList .item[data-sug]');
  const oreumId = firstOreum.dataset.sug;
  const oreumName = firstOreum.querySelector('.nm').textContent;
  firstOreum.click();
  await sleep(30);

  t('오름 이름이 미리 채워진다', () => {
    assert.strictEqual(e.$('sheet').hidden, false);
    assert.strictEqual(e.$('sName').value, oreumName, `${e.$('sName').value} vs ${oreumName}`);
  });

  t('종류가 오름으로 잡힌다', () => assert.strictEqual(e.app.draft.kind, 'oreum'));
  t('오름 좌표가 들어간다', () => {
    assert.strictEqual(String(e.app.draft.oreumId), String(oreumId));
    assert.ok(e.app.draft.lat > 33, String(e.app.draft.lat));
  });

  e.$('sSave').click();
  await sleep(30);
  t('정복도가 1/68로 오른다', () => {
    assert.ok(e.$('oreumStats').textContent.includes('1 / 68'), e.$('oreumStats').textContent);
  });
  t('목록에서 ✅로 바뀐다', () => {
    const el = e.doc.querySelector(`#oreumList .item[data-sug="${oreumId}"] .ico`);
    assert.strictEqual(el.textContent, '✅');
  });
  t('다녀온 오름은 맨 아래로 내려간다', () => {
    const items = [...e.doc.querySelectorAll('#oreumList .item')];
    const idx = items.findIndex((x) => x.dataset.sug === String(oreumId));
    assert.ok(idx > 60, '위치 ' + idx);
  });
  t('추천에서 빠진다', () => {
    const sug = [...e.doc.querySelectorAll('#suggest .item')].map((x) => x.dataset.sug);
    assert.ok(!sug.includes(String(oreumId)), sug.join(','));
  });

  /* ═══════ 오름을 여는 세 경로 ═══════ */
  console.log('\n[오름을 여는 세 경로]');
  {
    const p = await boot({});
    const o = p.app.oreum[5];

    const open = (el) => { p.$('sheet').hidden = true; el.click(); };

    open(p.doc.querySelector(`#oreumList .item[data-sug="${o.i}"]`));
    t('목록에서 열면 이름·좌표가 채워진다', () => {
      assert.strictEqual(p.$('sheet').hidden, false, '시트가 안 열림');
      assert.strictEqual(p.$('sName').value, o.n, `${p.$('sName').value} vs ${o.n}`);
      assert.strictEqual(String(p.app.draft.oreumId), String(o.i));
      assert.strictEqual(p.app.draft.kind, 'oreum');
    });

    const sug = p.doc.querySelector('#suggest .item[data-sug]');
    const want = sug.querySelector('.nm').textContent;
    open(sug);
    t('추천에서 열어도 이름이 채워진다', () => {
      assert.strictEqual(p.$('sheet').hidden, false, '시트가 안 열림');
      assert.strictEqual(p.$('sName').value, want, `${p.$('sName').value} vs ${want}`);
      assert.strictEqual(p.app.draft.kind, 'oreum');
    });

    // 지도 팝업의 '여기 다녀옴 기록' 링크 경로 (renderMap이 만드는 것과 같은 마크업)
    const holder = p.doc.createElement('div');
    holder.innerHTML = `<a href="#" data-go="${o.i}">여기 다녀옴 기록</a>`;
    p.doc.body.appendChild(holder);
    const a = holder.querySelector('a');
    p.$('sheet').hidden = true;
    // jsdom에서 a.click()은 기본 동작만 돌 수 있어 버블링되는 이벤트를 직접 보낸다
    a.dispatchEvent(new p.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    t('지도 팝업 링크에서 열어도 이름이 채워진다', () => {
      assert.strictEqual(p.$('sheet').hidden, false, '시트가 안 열림');
      assert.strictEqual(p.$('sName').value, o.n, `${p.$('sName').value} vs ${o.n}`);
      assert.strictEqual(String(p.app.draft.oreumId), String(o.i));
    });
    a.remove();

    t('검색 결과에서 열어도 이름이 채워진다', () => {
      p.$('sheet').hidden = true;
      p.$('q').value = o.n; p.$('q').oninput();
      const hit = p.doc.querySelector('#results .item[data-sug]');
      assert.ok(hit, '검색 결과가 없음: ' + p.$('results').textContent.slice(0, 60));
      hit.click();
      assert.strictEqual(p.$('sName').value, o.n, `${p.$('sName').value} vs ${o.n}`);
    });
  }

  /* ═══════ 검색 ═══════ */
  console.log('\n[검색]');
  const q = e.$('q');
  q.value = '국수'; q.oninput();
  t('내 기록이 먼저 뜬다', () => {
    const head = e.doc.querySelector('#results .secHead').textContent;
    assert.strictEqual(head, '내 기록', head);
    assert.ok(e.$('results').textContent.includes('고기국수집'));
  });
  t('검색 중에는 통계를 숨긴다', () => assert.strictEqual(e.$('logStats').hidden, true));

  q.value = 'ㄱㄱㄱㅅ'; q.oninput();
  t('초성으로도 찾는다', () => {
    assert.ok(e.$('results').textContent.includes('고기국수집'), e.$('results').textContent.slice(0, 100));
  });

  q.value = '오름'; q.oninput();
  t('안 간 오름 구역이 따로 나온다', () => {
    const heads = [...e.doc.querySelectorAll('#results .secHead')].map((x) => x.textContent);
    assert.ok(heads.includes('아직 안 간 오름'), heads.join(','));
  });

  q.value = '없는이름xyz'; q.oninput();
  t('결과가 없으면 그 이름으로 기록하게 해준다', () => {
    assert.ok(e.$('results').textContent.includes('기록이 없습니다'));
    assert.ok(e.$('addNew'), '버튼 없음');
  });
  e.$('addNew').click();
  await sleep(20);
  t('누르면 그 이름이 채워진 채 열린다', () => {
    assert.strictEqual(e.$('sheet').hidden, false);
    assert.strictEqual(e.$('sName').value, '없는이름xyz');
  });
  e.$('sheetClose').click();

  e.$('qClear').click();
  t('지움을 누르면 목록으로 돌아온다', () => {
    assert.strictEqual(q.value, '');
    assert.strictEqual(e.$('results').innerHTML, '');
    assert.strictEqual(e.$('logStats').hidden, false);
  });

  /* ═══════ 고치기·지우기 ═══════ */
  console.log('\n[고치기 · 지우기]');
  const before = e.state().visits.length;
  e.doc.querySelector('#logList .item[data-vid]').click();
  await sleep(20);
  t('기록을 누르면 내용이 채워진 채 열린다', () => {
    assert.strictEqual(e.$('sheet').hidden, false);
    assert.ok(e.$('sName').value.length > 0);
    assert.strictEqual(e.$('sDel').hidden, false, '삭제 버튼이 없음');
  });
  e.$('sName').value = '고친이름';
  e.$('sSave').click();
  await sleep(20);
  t('고치면 개수는 그대로고 이름만 바뀐다', () => {
    const s = e.state();
    assert.strictEqual(s.visits.length, before);
    assert.ok(s.visits.some((v) => v.name === '고친이름'), s.visits.map((v) => v.name).join(','));
  });

  e.doc.querySelector('#logList .item[data-vid]').click();
  await sleep(20);
  e.$('sDel').click();
  await sleep(20);
  t('지우면 하나 줄어든다', () => assert.strictEqual(e.state().visits.length, before - 1));
  t('되돌리기가 뜬다', () => {
    assert.strictEqual(e.$('undo').hidden, false);
    assert.ok(e.$('undoText').textContent.includes('지웠습니다'), e.$('undoText').textContent);
  });
  e.$('undoBtn').click();
  await sleep(20);
  t('되돌리면 살아난다', () => {
    assert.strictEqual(e.state().visits.length, before);
    assert.strictEqual(e.$('undo').hidden, true);
  });

  /* ═══════ 고치는 방법이 보이나 ═══════ */
  console.log('\n[기록 수정 단서]');
  {
    const p = await boot({ seed: { version: 1, visits: [
      { id: 'a', kind: 'food', name: '해장국집', date: '2026-09-24', time: '08:00',
        lat: 33.5, lon: 126.5, oreumId: null, note: '', photo: null, snap: null, ts: 1 },
    ] }, wait: 300 });
    p.doc.querySelector('#tabbar button[data-tab="log"]').click();
    const first = p.$('logList').querySelector('.item');
    t('기록 항목에 고치기 표시가 있다', () => {
      const e2 = first.querySelector('.rt.edit');
      assert.ok(e2, '고치기 표시가 없음 — 누를 수 있는지 알 수 없다');
      assert.ok(e2.textContent.includes('고치기'), e2.textContent);
    });
    t('기록이 적을 때 안내 한 줄이 뜬다', () => {
      assert.ok(p.$('logList').querySelector('.hint'), '안내가 없음');
    });
    t('눌러서 실제로 고칠 수 있다', () => {
      first.click();
      assert.strictEqual(p.$('sheet').hidden, false, '시트가 안 열림');
      assert.strictEqual(p.$('sName').value, '해장국집');
    });
  }
  {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: 'v' + i, kind: 'food', name: '가게' + i, date: '2026-09-2' + (i % 5), time: '08:00',
      lat: 33.5, lon: 126.5, oreumId: null, note: '', photo: null, snap: null, ts: i }));
    const p2 = await boot({ seed: { version: 1, visits: many }, wait: 300 });
    p2.doc.querySelector('#tabbar button[data-tab="log"]').click();
    t('기록이 쌓이면 안내는 사라진다', () => {
      assert.strictEqual(p2.$('logList').querySelector('.hint'), null, '계속 뜨면 잔소리가 된다');
      assert.ok(p2.$('logList').querySelector('.rt.edit'), '고치기 표시는 남아야 함');
    });
  }

  /* ═══════ 탭 ═══════ */
  console.log('\n[탭]');
  ['log', 'list', 'map'].forEach((name) => {
    e.doc.querySelector(`#tabbar button[data-tab="${name}"]`).click();
    t(`${name} 탭으로 넘어간다`, () => {
      assert.ok(e.$('pane-' + name).classList.contains('on'));
      assert.strictEqual(e.doc.querySelectorAll('.pane.on').length, 1);
    });
  });

  /* ═══════ 내보내기 ═══════ */
  console.log('\n[내보내기]');
  e.app.exportCSV();
  t('CSV가 만들어진다', () => assert.ok(e.downloads.length >= 1, '다운로드 없음'));
  const blob = e.downloads[e.downloads.length - 1];
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = await blob.text();   // TextDecoder가 BOM을 떼므로 본문 확인용
  t('엑셀에서 안 깨지게 BOM이 붙는다', () => {
    assert.deepStrictEqual([bytes[0], bytes[1], bytes[2]], [0xEF, 0xBB, 0xBF],
      '앞 3바이트: ' + [...bytes.slice(0, 3)]);
  });
  t('헤더와 기록이 들어간다', () => {
    assert.ok(text.includes('날짜,시각,종류,이름'), text.slice(0, 60));
    assert.ok(text.includes('6물'), '물때가 안 들어감');
  });

  /* ═══════ 저장한 게 다시 뜨는가 ═══════ */
  console.log('\n[앱 껐다 켜기]');
  const saved = e.state();
  const r = await boot({ seed: saved });
  t('기록이 그대로 살아있다', () => {
    assert.strictEqual(r.app.state.visits.length, saved.visits.length);
    assert.ok(r.$('logList').textContent.includes(saved.visits[0].name));
  });
  t('오름 정복도도 유지된다', () => {
    assert.ok(r.$('oreumStats').textContent.includes('1 / 68'), r.$('oreumStats').textContent);
  });
  t('저장분이 깨져 있어도 앱이 뜬다', async () => {});
  const broken = await boot({ seed: '{{{깨진', wait: 200 });
  t('깨진 저장분이면 빈 상태로 시작한다', () => {
    assert.deepStrictEqual(broken.errors, []);
    assert.strictEqual(broken.app.state.visits.length, 0);
  });
  const weird = await boot({ seed: '{"version":1,"visits":"배열이 아님"}', wait: 250 });
  t('visits가 배열이 아닌 저장분도 버틴다', () => {
    assert.deepStrictEqual(weird.errors, []);
    assert.ok(Array.isArray(weird.app.state.visits), typeof weird.app.state.visits);
    assert.strictEqual(weird.app.state.visits.length, 0);
    assert.ok(weird.$('logList').textContent.includes('아직 기록이 없습니다'));
  });
  const noVisits = await boot({ seed: '{"version":1}', wait: 250 });
  t('visits가 아예 없는 저장분도 버틴다', () => {
    assert.deepStrictEqual(noVisits.errors, []);
    assert.strictEqual(noVisits.app.state.visits.length, 0);
    assert.strictEqual(noVisits.doc.querySelectorAll('#oreumList .item').length, 68);
  });

  /* ═══════ 저장된 날씨로 다시 켜기 (실기에서 터졌던 버그) ═══════ */
  console.log('\n[저장된 날씨로 다시 켜기]');
  {
    // 정상 기동으로 날씨를 받아 캐시에 넣은 뒤, 그 캐시만 가지고 다시 띄운다.
    const warm = await boot({});
    const wxCache = warm.window.localStorage.getItem('oneul_wx');
    assert.ok(wxCache, '날씨 캐시가 저장되지 않음');
    assert.ok(JSON.parse(wxCache).data.tides.length > 0, '조석이 캐시에 없음');

    const cold = await boot({
      offline: true,                       // 네트워크는 죽었고
      wxCache: wxCache,                    // 저장된 날씨만 있다
      seed: { version: 1, visits: [
        { id: 'a', kind: 'food', name: '해장국집', date: '2026-09-24', time: '08:00',
          lat: null, lon: null, oreumId: null, note: '', photo: null, snap: null, ts: 1 },
        { id: 'b', kind: 'oreum', name: '가세오름', date: '2026-09-24', time: '09:00',
          lat: 33.4, lon: 126.8, oreumId: 52, note: '', photo: null, snap: null, ts: 2 },
      ] },
      wait: 300,
    });
    t('저장된 날씨로 켜도 오류가 없다', () => assert.deepStrictEqual(cold.errors, []));
    t('저장된 날씨로 켜도 조석 시각이 나온다', () => {
      assert.ok(/\d{2}:\d{2}/.test(cold.$('vFacts').textContent), cold.$('vFacts').textContent);
    });
    t('저장된 날씨로 켜도 오름 목록이 그려진다', () => {
      assert.strictEqual(cold.doc.querySelectorAll('#oreumList .item').length, 68);
    });
    t('저장된 날씨로 켜도 정복도가 나온다', () => {
      assert.ok(cold.$('oreumStats').textContent.includes('1 / 68'), cold.$('oreumStats').textContent);
    });
    t('저장된 날씨로 켜도 기록 목록이 그려진다', () => {
      assert.ok(cold.$('logList').textContent.includes('해장국집'), cold.$('logList').textContent.slice(0, 60));
    });
    t('저장된 날씨로 켜도 추천이 나온다', () => {
      assert.ok(cold.doc.querySelectorAll('#suggest .item').length >= 3);
    });
    t('저장분에서 읽은 조석이 Date로 되살아난다', () => {
      // 문자열로 남으면 이후 시간 계산(간조 전후 판단 등)이 조용히 틀린다
      assert.ok(cold.app.wx && cold.app.wx.tides.length > 0, '조석이 없음');
      cold.app.wx.tides.forEach((t2, i) => {
        assert.ok(t2.at instanceof cold.window.Date || t2.at instanceof Date,
          `tides[${i}].at 이 Date가 아님: ${typeof t2.at} ${t2.at}`);
      });
    });
    t('저장분으로도 간조 전후 추천이 동작한다', () => {
      // at이 문자열이면 시각 비교가 깨져 바다 추천이 안 뜨거나 잘못 뜬다
      const lows = cold.app.wx.tides.filter((x) => x.type === 'low');
      assert.ok(lows.length > 0, '저조가 없음');
      const r2 = cold.C.suggest(
        { oreum: cold.app.oreum, visits: [] }, null,
        { now: new Date(lows[0].at.getTime() - 30 * 60000), lowTide: lows[0].at }, 5);
      assert.strictEqual(r2[0].kind, 'sea', JSON.stringify(r2[0]));
    });
  }

  /* ═══════ 오프라인 ═══════ */
  console.log('\n[통신 끊김]');
  const off = await boot({ offline: true, wait: 300 });
  t('날씨를 못 받아도 앱이 죽지 않는다', () => assert.deepStrictEqual(off.errors, []));
  t('못 받았다고 알려주고 다시 시도 버튼을 준다', () => {
    assert.ok(off.$('vLabel').textContent.includes('못 받음'), off.$('vLabel').textContent);
    assert.strictEqual(off.$('vRetry').hidden, false);
  });
  t('날씨가 없어도 물때·달은 나온다', () => {
    const f = off.$('vFacts').textContent;
    assert.ok(f.includes('6물'), f);
    assert.ok(f.includes('🌙'), f);
  });
  t('날씨가 없으면 칩이 물때·달 둘뿐이다', () => {
    assert.strictEqual(off.doc.querySelectorAll('#vFacts span').length, 2,
      off.$('vFacts').textContent);
  });
  t('날씨가 없어도 기록은 할 수 있다', () => {
    off.$('fab').click();
    off.$('sName').value = '오프라인기록';
    off.$('sSave').click();
    const s = off.state();
    assert.ok(s && s.visits.length === 1, JSON.stringify(s));
    assert.strictEqual(s.visits[0].snap.multtae, '6물');
  });

  /* ═══════ 위치 거부 ═══════ */
  console.log('\n[위치 거부]');
  const ng = await boot({ geo: null, wait: 250 });
  t('위치를 거부해도 앱이 돈다', () => assert.deepStrictEqual(ng.errors, []));
  t('거리 없이 이름순으로 보여준다', () => {
    assert.strictEqual(ng.doc.querySelectorAll('#oreumList .item').length, 68);
    assert.strictEqual(ng.doc.querySelector('#oreumList .item .rt').textContent, '');
  });
  t('추천도 나온다', () => assert.ok(ng.doc.querySelectorAll('#suggest .item').length >= 3));

  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error('테스트 실행 오류:', err); process.exit(1); });
