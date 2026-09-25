/* 오늘 나가? — 화면·저장·네트워크
 * 순수 로직은 core.js(ONCore)에 있다. 여기는 DOM과 바깥 세계만 다룬다.
 */
(function () {
  'use strict';

  const C = window.ONCore;
  const $ = (id) => document.getElementById(id);
  const KEY = 'oneul_state';
  const WX_KEY = 'oneul_wx';
  const JEJU = { lat: 33.4996, lon: 126.5312 };

  /* ═══════════ 상태 ═══════════ */

  let S = { visits: [], version: 1 };
  let oreum = [];               // data/oreum.json
  let here = null;              // 현재 위치 {lat, lon}
  let wx = null;                // 날씨·조석 묶음
  let map = null, layer = null, meMarker = null;
  let sheetMode = null;         // 'new' | 기존 id
  let draft = null;
  let lastDeleted = null, undoTimer = null;

  /* ═══════════ 저장 ═══════════ */

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && Array.isArray(p.visits)) S = p;
      }
    } catch (e) { /* 깨진 저장분은 버리고 새로 시작 */ }
  }

  /** 기록은 누를 때마다 바로 저장한다. 저장 버튼은 없다. */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
    } catch (e) {
      toast('저장 공간이 꽉 찼습니다. 사진을 줄여보세요.');
    }
  }

  function db() { return { visits: S.visits, oreum: oreum }; }

  /* ═══════════ 알림 ═══════════ */

  let toastTimer = null;
  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2200);
  }

  function buzz(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms || 12); } catch (e) {} }
  }

  function showUndo(text, fn) {
    lastDeleted = fn;
    $('undoText').textContent = text;
    $('undo').hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { $('undo').hidden = true; lastDeleted = null; }, 6000);
  }

  /* ═══════════ 타일 캐시 (오프라인 지도) ═══════════ */

  const TileCache = (function () {
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('no idb'));
        const r = indexedDB.open('oneul_tiles', 1);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains('t')) r.result.createObjectStore('t');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }).catch(() => null);
      return dbp;
    }
    return {
      async get(k) {
        const d = await open(); if (!d) return null;
        return new Promise((res) => {
          const rq = d.transaction('t').objectStore('t').get(k);
          rq.onsuccess = () => res(rq.result || null);
          rq.onerror = () => res(null);
        });
      },
      async put(k, blob) {
        const d = await open(); if (!d) return;
        try { d.transaction('t', 'readwrite').objectStore('t').put(blob, k); } catch (e) {}
      },
      async count() {
        const d = await open(); if (!d) return 0;
        return new Promise((res) => {
          const rq = d.transaction('t').objectStore('t').count();
          rq.onsuccess = () => res(rq.result || 0);
          rq.onerror = () => res(0);
        });
      },
    };
  })();

  /** 한 번 본 타일은 저장해 두고, 통신이 끊기면 그걸 쓴다. */
  function makeTileLayer() {
    if (!window.L) return null;
    const Cached = L.TileLayer.extend({
      createTile: function (coords, done) {
        const img = document.createElement('img');
        img.alt = '';
        const key = `${coords.z}/${coords.x}/${coords.y}`;
        const url = this.getTileUrl(coords);
        let settled = false;
        const finish = (err) => { if (!settled) { settled = true; done(err, img); } };

        TileCache.get(key).then((blob) => {
          if (blob) {
            img.src = URL.createObjectURL(blob);
            img.onload = () => { URL.revokeObjectURL(img.src); finish(null); };
            img.onerror = () => fetchNet();
          } else {
            fetchNet();
          }
        }).catch(fetchNet);

        function fetchNet() {
          fetch(url, { mode: 'cors' })
            .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('tile ' + r.status))))
            .then((blob) => {
              TileCache.put(key, blob);
              const u = URL.createObjectURL(blob);
              img.onload = () => { URL.revokeObjectURL(u); finish(null); };
              img.onerror = () => finish(new Error('decode'));
              img.src = u;
            })
            .catch((e) => finish(e));
        }
        return img;
      },
    });
    return new Cached('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, minZoom: 8,
      attribution: '© OpenStreetMap',
      crossOrigin: true,
    });
  }

  /* ═══════════ 날씨·조석 ═══════════ */

  function cacheWx(data) {
    try { localStorage.setItem(WX_KEY, JSON.stringify({ at: Date.now(), lat: data.lat, lon: data.lon, data: data })); } catch (e) {}
  }
  function cachedWx() {
    try {
      const p = JSON.parse(localStorage.getItem(WX_KEY) || 'null');
      if (p && p.data && Date.now() - p.at < 12 * 3600 * 1000) {
        // JSON을 거치며 Date가 문자열이 됐다. 되살려서 넘긴다.
        p.data.tides = (p.data.tides || []).map(C.reviveTide).filter(Boolean);
        p.data.sea = p.data.sea || [];
        return p.data;
      }
    } catch (e) {}
    return null;
  }

  /**
   * 날씨 + 조석을 한 번에 받는다. 키가 필요 없는 Open-Meteo를 쓴다.
   * 실패하면 마지막으로 받은 값을 쓴다(12시간 이내).
   */
  async function fetchWeather(lat, lon) {
    const w = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&hourly=temperature_2m,precipitation_probability,wind_speed_10m,cloud_cover,weather_code' +
      '&daily=sunrise,sunset&timezone=Asia%2FSeoul&forecast_days=2';
    const m = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
      '&hourly=sea_level_height_msl,wave_height&timezone=Asia%2FSeoul&forecast_days=2';

    const [wr, mr] = await Promise.allSettled([
      fetch(w).then((r) => (r.ok ? r.json() : Promise.reject(new Error('wx ' + r.status)))),
      fetch(m).then((r) => (r.ok ? r.json() : Promise.reject(new Error('marine ' + r.status)))),
    ]);
    if (wr.status !== 'fulfilled') throw wr.reason || new Error('날씨 실패');

    const W = wr.value;
    const hours = W.hourly.time.map((t, i) => ({
      time: t,
      temp: W.hourly.temperature_2m[i],
      rain: W.hourly.precipitation_probability[i],
      wind: W.hourly.wind_speed_10m[i],
      cloud: W.hourly.cloud_cover[i],
    }));

    let tides = [], wave = null, sea = [];
    if (mr.status === 'fulfilled' && mr.value.hourly) {
      const H = mr.value.hourly;
      tides = C.tideExtremes(H.time, H.sea_level_height_msl || []);
      const wv = H.wave_height || [];
      const idx = nowIndex(H.time);
      wave = idx >= 0 ? wv[idx] : null;
      // 곡선을 그리려면 극값이 아니라 시간별 원본이 필요하다
      sea = (H.time || []).map((t, i) => ({
        time: t,
        h: (H.sea_level_height_msl || [])[i],
        wave: wv[i] == null ? null : wv[i],
      }));
    }

    const out = {
      lat: lat, lon: lon, at: Date.now(),
      hours: hours, tides: tides, wave: wave, sea: sea,
      sunrise: (W.daily.sunrise || [])[0], sunset: (W.daily.sunset || [])[0],
    };
    cacheWx(out);
    return out;
  }

  function nowIndex(times) {
    const now = new Date();
    const key = C.todayStr(now) + 'T' + String(now.getHours()).padStart(2, '0') + ':00';
    return times.indexOf(key);
  }

  /* ═══════════ 오늘 판정 렌더 ═══════════ */

  function renderVerdict() {
    const now = new Date();
    const lun = C.lunar(now);
    const mt = C.multtae(lun.day);
    const illum = C.moonIllum(lun.day);

    const wd = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];
    $('vDate').textContent = `${now.getMonth() + 1}/${now.getDate()} ${wd}`;
    $('vLunar').textContent = `음 ${lun.month}.${lun.day}`;

    const head = $('verdict');
    if (!wx) {
      $('vLabel').textContent = '날씨 못 받음';
      $('vDots').textContent = '';
      $('vWhy').textContent = '통신이 되면 자동으로 다시 시도합니다';
      $('vNow').textContent = '';
      head.className = '';
      $('vRetry').hidden = false;
      $('vFacts').innerHTML = factChips(mt, illum, null);
      return;
    }
    $('vRetry').hidden = true;

    const today = C.todayStr(now);
    const todayHours = wx.hours.filter((h) => h.time.slice(0, 10) === today);
    const v = C.dayVerdict(todayHours);

    $('vLabel').textContent = v.label;
    const filled = Math.floor(v.score);
    $('vDots').textContent = '●'.repeat(filled) + (v.score % 1 ? '◐' : '') + '○'.repeat(5 - filled - (v.score % 1 ? 1 : 0));
    head.className = v.score >= 3.5 ? 'good' : v.score >= 2 ? 'mid' : 'bad';

    const why = [];
    if (v.bestFrom && v.bestScore > v.score + 0.4) why.push(`${v.bestFrom.slice(0, 2)}시부터 나아짐`);
    why.push(...v.why);
    $('vWhy').textContent = why.slice(0, 2).join(' · ');

    const cur = wx.hours[nowIndex(wx.hours.map((h) => h.time))] ||
      todayHours[Math.min(now.getHours(), todayHours.length - 1)];
    $('vNow').textContent = cur
      ? `${Math.round(cur.temp)}° · 바람 ${Math.round(cur.wind)}m/s`
      : '';

    $('vFacts').innerHTML = factChips(mt, illum, wx);
  }

  /** 한 줄에 들어가게 중요한 것부터 넣는다: 물때 → 일몰 → 달 → 파고(거칠 때만) */
  function factChips(mt, illum, w) {
    const out = [];
    const nt = w && w.tides.length ? C.nextTide(w.tides, new Date()) : null;
    out.push(nt
      ? `<span>🌊 ${mt}·${nt.type === 'high' ? '만조' : '간조'} <b>${nt.t}</b></span>`
      : `<span>🌊 ${mt}</span>`);
    if (w && w.sunset) out.push(`<span>🌅 <b>${w.sunset.slice(11, 16)}</b></span>`);
    out.push(`<span>🌙 ${Math.round(illum * 100)}%</span>`);
    // 파고는 1m 넘을 때만 — 잔잔하면 굳이 자리를 차지하지 않는다
    if (w && w.wave != null && w.wave >= 1) out.push(`<span>파고 ${w.wave.toFixed(1)}m</span>`);
    return out.join('');
  }

  /* ═══════════ 지도 ═══════════ */

  function initMap() {
    if (!window.L || map) return;
    map = L.map('map', { zoomControl: true, attributionControl: true })
      .setView([JEJU.lat, JEJU.lon], 10);
    const tl = makeTileLayer();
    if (tl) tl.addTo(map);
    layer = L.layerGroup().addTo(map);
    renderMap();
    fitAll();
    // 화면 좌표로 묶으므로 줌·이동 후 다시 계산한다
    map.on('zoomend moveend', () => renderMap());
  }

  /** 오름과 내 기록이 모두 들어오게 지도를 맞춘다. 제주시만 보이면 마커 대부분이 화면 밖이다. */
  function fitAll() {
    if (!map) return;
    const pts = oreum.map((o) => [o.lat, o.lon])
      .concat(S.visits.filter((v) => v.lat != null).map((v) => [v.lat, v.lon]));
    if (!pts.length) return;
    try { map.fitBounds(L.latLngBounds(pts).pad(0.08)); } catch (e) {}
  }

  function pin(cls, size) {
    const s = size || 14;
    return L.divIcon({
      className: '', iconSize: [s, s], iconAnchor: [s / 2, s / 2],
      html: `<div class="pin ${cls}" style="width:${s}px;height:${s}px"></div>`,
    });
  }

  /** 여러 오름이 겹친 자리. 개수를 적고, 다녀온 비율만큼 테두리를 채운다. */
  function clusterIcon(n, done) {
    const s = n >= 12 ? 40 : n >= 6 ? 36 : 32;
    return L.divIcon({
      className: '', iconSize: [s, s], iconAnchor: [s / 2, s / 2],
      html: `<div class="cluster${done === n ? ' allDone' : done ? ' someDone' : ''}"
               style="width:${s}px;height:${s}px;line-height:${s}px">${n}</div>`,
    });
  }

  function renderMap() {
    if (!map || !layer) return;
    layer.clearLayers();

    const visitedOreum = new Set(S.visits.filter((v) => v.oreumId != null).map((v) => String(v.oreumId)));

    // 화면에서 겹치는 오름은 묶어서 개수로 보여준다.
    // 제주 전체를 폰 화면에 넣으면 69개가 떡져서 어느 것인지 알 수 없다.
    const pts = oreum.map((o) => {
      const p = map.latLngToContainerPoint([o.lat, o.lon]);
      return { x: p.x, y: p.y, o: o, done: visitedOreum.has(String(o.i)) };
    });

    C.clusterByPixel(pts, 26).forEach((c) => {
      const ll = map.containerPointToLatLng(L.point(c.x, c.y));
      if (c.items.length === 1) {
        const it = c.items[0], o = it.o;
        L.marker([o.lat, o.lon], { icon: pin(it.done ? 'done' : 'todo', it.done ? 16 : 12) })
          .bindPopup(`<b>${esc(o.n)}</b><br>${esc(o.d)} · ${C.altLabel(o.alt)}` +
            `<br>${it.done ? '✅ 다녀옴' : '아직 안 감'}` +
            `<br><a href="#" data-go="${o.i}">여기 다녀옴 기록</a>`)
          .addTo(layer);
        return;
      }
      // 묶음: 개수를 쓰고, 누르면 그 안으로 확대한다
      const doneN = c.items.filter((x) => x.done).length;
      const n = c.items.length;
      L.marker(ll, { icon: clusterIcon(n, doneN) })
        .on('click', () => {
          const b = L.latLngBounds(c.items.map((x) => [x.o.lat, x.o.lon]));
          map.fitBounds(b.pad(0.35), { maxZoom: 14 });
        })
        .bindTooltip(`오름 ${n}곳${doneN ? ` · ${doneN}곳 다녀옴` : ''} — 눌러서 펼치기`,
          { direction: 'top' })
        .addTo(layer);
    });

    // 내 기록 중 오름이 아닌 것 (좌표 없는 기록은 지도에 못 찍는다 — 목록에는 남는다)
    S.visits.filter((v) => v.oreumId == null && v.lat != null).forEach((v) => {
      L.marker([v.lat, v.lon], { icon: pin(v.kind, 15) })
        .bindPopup(`<b>${esc(v.name)}</b><br>${v.date} · ${C.KIND_LABEL[v.kind] || ''}` +
          (v.note ? '<br>' + esc(v.note) : ''))
        .addTo(layer);
    });

    if (here) {
      if (meMarker) layer.removeLayer(meMarker);
      meMarker = L.marker([here.lat, here.lon], { icon: pin('me', 16) }).addTo(layer);
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ═══════════ 추천 ═══════════ */

  function renderSuggest() {
    const low = wx && wx.tides.length
      ? wx.tides.filter((t) => t.type === 'low' && t.at >= new Date()).sort((a, b) => a.at - b.at)[0]
      : null;
    const list = C.suggest(db(), here, { now: new Date(), lowTide: low ? low.at : null }, 6);
    const el = $('suggest');
    if (!list.length) {
      el.innerHTML = '<div class="empty">추천할 곳이 없습니다</div>';
      return;
    }
    el.innerHTML = '<div class="secHead">오늘 어디 갈까</div>' + list.map((x) => {
      const sub = [x.area, C.altLabel(x.alt), ...(x.why || [])].filter(Boolean).join(' · ');
      return `<button class="item" data-sug="${x.oreumId == null ? '' : x.oreumId}" data-kind="${x.kind}">
        <span class="ico">${C.KIND_ICON[x.kind] || '📍'}</span>
        <span class="body"><span class="nm">${esc(x.name)}</span><span class="sub">${esc(sub)}</span></span>
        <span class="rt">${x.dist != null ? C.distLabel(x.dist) : ''}</span>
      </button>`;
    }).join('');
  }

  /* ═══════════ 검색 · 기록 목록 ═══════════ */

  function renderResults() {
    const q = $('q').value.trim();
    $('qClear').hidden = !q;
    const el = $('results');
    if (!q) { el.innerHTML = ''; renderLog(); return; }

    const hits = C.searchPlaces(db(), q, 30);
    if (!hits.length) {
      el.innerHTML = `<div class="empty">'${esc(q)}' 기록이 없습니다<br>` +
        `<button class="ghost sm" id="addNew" style="margin-top:10px">이 이름으로 기록하기</button></div>`;
      $('addNew').onclick = () => openSheet({ name: q });
      return;
    }
    const mine = hits.filter((h) => h.mine);
    const other = hits.filter((h) => !h.mine);
    let html = '';
    if (mine.length) {
      html += '<div class="secHead">내 기록</div>' + mine.map((h) => {
        const sub = [h.count > 1 ? h.count + '번 감' : '', h.last].filter(Boolean).join(' · ');
        return `<button class="item mine" data-vid="${esc(h.id)}">
          <span class="ico">${C.KIND_ICON[h.kind] || '📍'}</span>
          <span class="body"><span class="nm">${esc(h.name)}</span><span class="sub">${esc(sub)}</span></span>
        </button>`;
      }).join('');
    }
    if (other.length) {
      html += '<div class="secHead">아직 안 간 오름</div>' + other.map((h) => {
        const d = here ? C.distance(here.lat, here.lon, h.lat, h.lon) : null;
        return `<button class="item" data-sug="${h.oreumId}" data-kind="oreum">
          <span class="ico">⛰</span>
          <span class="body"><span class="nm">${esc(h.name)}</span><span class="sub">${esc([h.area, C.altLabel(h.alt)].filter(Boolean).join(' · '))}</span></span>
          <span class="rt">${d != null ? C.distLabel(d) : ''}</span>
        </button>`;
      }).join('');
    }
    el.innerHTML = html;
    $('logStats').hidden = true;
    $('logList').innerHTML = '';
  }

  /* ═══════════ 그래프 ═══════════ */

  const W = 340, PAD = 8;

  /** 지금 시각을 세로선으로 긋는다. 어디가 '현재'인지 없으면 읽기 어렵다. */
  function nowLine(p, h) {
    const now = Date.now();
    if (now < p.t0 || now > p.t1) return '';
    const x = C2(p.xOf(new Date(now)));
    return `<line class="nowline" x1="${x}" y1="0" x2="${x}" y2="${h}"/>`;
  }
  function C2(n) { return Math.round(n * 10) / 10; }

  /** 물때 곡선 — 만조·간조를 점으로 찍고 시각을 쓴다. */
  function chartTide() {
    if (!wx || !wx.sea || wx.sea.length < 3) return '';
    const h = 118;
    const p = C.plot(wx.sea.map((s) => ({ time: s.time, v: s.h })), { w: W, h: h, pad: PAD });
    if (!p) return '';

    const line = C.smoothPath(p.pts);
    const area = `${line}L${C2(p.pts[p.pts.length - 1].x)},${h}L${C2(p.pts[0].x)},${h}Z`;

    // 만조·간조 표시
    const marks = (wx.tides || []).filter((t) => {
      const ms = t.at.getTime();
      return ms >= p.t0 && ms <= p.t1;
    }).map((t) => {
      const x = C2(p.xOf(t.at)), y = C2(p.yOf(t.h));
      const up = t.type === 'high';
      const ty = up ? Math.max(10, y - 10) : Math.min(h - 2, y + 17);
      // 양 끝 라벨은 가운데 맞추면 화면 밖으로 잘린다
      const la = C.labelAnchor(x, W, 18);
      const anchor = la.anchor, tx = la.x;
      return `<circle class="tideDot ${t.type}" cx="${x}" cy="${y}" r="3.5"/>` +
        `<text class="tideTxt" x="${tx}" y="${ty}" text-anchor="${anchor}">${up ? '만' : '간'} ${t.t}</text>`;
    }).join('');

    return card('물때', `${wx.tides.length ? '' : ''}`,
      `<svg viewBox="0 0 ${W} ${h}" class="chart" role="img" aria-label="조위 곡선">
        <path class="tideArea" d="${area}"/>
        <path class="tideLine" d="${line}"/>
        ${nowLine(p, h)}${marks}
      </svg>
      <div class="axis"><span>${dayLabel(p.t0)}</span><span>${dayLabel(p.t1)}</span></div>`);
  }

  function dayLabel(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}시`;
  }

  /** 시간별 날씨 — 기온 선 + 강수확률 막대 */
  function chartWeather() {
    if (!wx || !wx.hours || wx.hours.length < 3) return '';
    const h = 108;
    const rows = wx.hours.slice(0, 48);
    const pt = C.plot(rows.map((r) => ({ time: r.time, v: r.temp })), { w: W, h: h, pad: PAD });
    if (!pt) return '';

    const bars = rows.map((r) => {
      if (r.rain == null) return '';
      const x = C2(pt.xOf(r.time));
      const bh = C2((r.rain / 100) * (h - PAD * 2));
      return bh < 1 ? '' : `<rect class="rainBar" x="${C2(x - 2.5)}" y="${C2(h - bh)}" width="5" height="${bh}"/>`;
    }).join('');

    return card('기온과 비', `${Math.round(pt.min)}~${Math.round(pt.max)}°`,
      `<svg viewBox="0 0 ${W} ${h}" class="chart" role="img" aria-label="기온과 강수확률">
        ${bars}<path class="tempLine" d="${C.smoothPath(pt.pts)}"/>${nowLine(pt, h)}
      </svg>
      <div class="axis"><span>파란 막대 = 비 올 확률</span><span>${dayLabel(pt.t1)}</span></div>`);
  }

  /** 바람 — 세기별 색으로 */
  function chartWind() {
    if (!wx || !wx.hours || wx.hours.length < 3) return '';
    const h = 86;
    const rows = wx.hours.slice(0, 48);
    const p = C.plot(rows.map((r) => ({ time: r.time, v: r.wind })), { w: W, h: h, pad: PAD });
    if (!p) return '';
    const bars = rows.map((r) => {
      if (r.wind == null) return '';
      const x = C2(p.xOf(r.time)), y = C2(p.yOf(r.wind));
      const cls = r.wind >= 10 ? 'strong' : r.wind >= 7 ? 'mid' : 'calm';
      return `<rect class="windBar ${cls}" x="${C2(x - 2.5)}" y="${y}" width="5" height="${C2(h - y)}"/>`;
    }).join('');
    return card('바람', `최대 ${Math.round(p.max)}m/s`,
      `<svg viewBox="0 0 ${W} ${h}" class="chart" role="img" aria-label="시간별 바람">
        ${bars}${nowLine(p, h)}
      </svg>
      <div class="axis"><span><i class="sw calm"></i>약함 <i class="sw mid"></i>보통 <i class="sw strong"></i>강함</span></div>`);
  }

  /** 오름 정복 — 읍면동별 가로 막대 */
  function chartOreum() {
    if (!oreum.length) return '';
    // 한 곳도 안 갔으면 빈 막대만 늘어선다 — 기록이 생기면 보여준다
    if (!S.visits.some((v) => v.oreumId != null)) return '';
    const rows = C.oreumByArea(oreum, S.visits);
    const done = rows.reduce((s, r) => s + r.done, 0);
    const bars = rows.map((r) => {
      const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
      return `<div class="hbar">
        <span class="hbName">${esc(r.area)}</span>
        <span class="hbTrack"><i style="width:${pct}%"></i></span>
        <span class="hbNum">${r.done}/${r.total}</span>
      </div>`;
    }).join('');
    return card('오름 정복', `${done}/${oreum.length}`, `<div class="hbars">${bars}</div>`);
  }

  /** 기록 추이 — 월별 막대 */
  function chartMonths() {
    const rows = C.countByMonth(S.visits);
    if (!rows.length) return '';
    const max = Math.max(...rows.map((r) => r.n));
    const bars = rows.slice(-12).map((r) => {
      const pct = Math.round((r.n / max) * 100);
      return `<div class="vbar" title="${r.month} · ${r.n}번">
        <span class="vbNum">${r.n}</span>
        <span class="vbTrack"><i style="height:${Math.max(pct, 4)}%"></i></span>
        <span class="vbName">${r.month.slice(5)}</span>
      </div>`;
    }).join('');
    return card('기록 추이', `${S.visits.length}번`, `<div class="vbars">${bars}</div>`);
  }

  /** 무엇을 하고 다녔나 — 종류별 */
  function chartKinds() {
    if (!S.visits.length) return '';
    const s = C.summarize(S.visits);
    const rows = C.KINDS.map((k) => ({ k: k, n: s.byKind[k.v] || 0 })).filter((r) => r.n > 0);
    if (!rows.length) return '';
    const max = Math.max(...rows.map((r) => r.n));
    const bars = rows.map((r) => `<div class="hbar">
      <span class="hbName">${r.k.icon} ${esc(r.k.label)}</span>
      <span class="hbTrack"><i style="width:${Math.round((r.n / max) * 100)}%"></i></span>
      <span class="hbNum">${r.n}</span>
    </div>`).join('');
    return card('무엇을 했나', '', `<div class="hbars">${bars}</div>`);
  }

  function card(title, note, body) {
    return `<section class="cardBox">
      <div class="cardHead"><b>${esc(title)}</b><span>${esc(note || '')}</span></div>
      ${body}
    </section>`;
  }

  function renderCharts() {
    const el = $('charts');
    if (!el) return;
    const parts = [chartTide(), chartWeather(), chartWind(),
      chartOreum(), chartMonths(), chartKinds()].filter(Boolean);
    el.innerHTML = parts.length ? parts.join('')
      : '<div class="empty">아직 보여줄 게 없습니다<br>날씨를 받아오거나 기록을 남겨보세요</div>';
  }

  function renderLog() {
    $('logStats').hidden = false;
    const s = C.summarize(S.visits);
    $('logStats').innerHTML =
      `<span><b>${s.total}</b>번 기록</span>` +
      `<span>⛰ <b>${s.oreumDone}</b>/${oreum.length} 오름</span>` +
      `<span>🍚 <b>${s.byKind.food}</b></span>` +
      `<button class="ghost sm" id="btnExport" style="margin-left:auto">내보내기</button>`;
    $('btnExport').onclick = exportCSV;

    const list = S.visits.slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    if (!list.length) {
      $('logList').innerHTML = '<div class="empty">아직 기록이 없습니다<br>아래 ＋다녀옴 을 눌러보세요</div>';
      return;
    }
    let cur = '';
    const hint = list.length <= 3
      ? '<div class="hint">기록을 누르면 고치거나 지울 수 있습니다</div>' : '';
    $('logList').innerHTML = hint + list.map((v) => {
      const m = v.date.slice(0, 7);
      let head = '';
      if (m !== cur) { cur = m; head = `<div class="secHead">${m.replace('-', '년 ')}월</div>`; }
      const sub = [v.date.slice(5) + ' ' + v.time, v.snap && v.snap.multtae, v.note].filter(Boolean).join(' · ');
      return head + `<button class="item" data-vid="${esc(v.id)}">
        ${v.photo ? `<img class="thumb" src="${v.photo}" alt="">` : `<span class="ico">${C.KIND_ICON[v.kind] || '📍'}</span>`}
        <span class="body"><span class="nm">${esc(v.name || '(이름 없음)')}</span><span class="sub">${esc(sub)}</span></span>
        <span class="rt edit" aria-hidden="true">고치기 ›</span>
      </button>`;
    }).join('');
  }

  function renderOreumList() {
    const visited = new Set(S.visits.filter((v) => v.oreumId != null).map((v) => String(v.oreumId)));
    const done = oreum.filter((o) => visited.has(String(o.i))).length;
    const pct = oreum.length ? Math.round((done / oreum.length) * 100) : 0;
    $('oreumStats').innerHTML =
      `<span><b>${done}</b> / ${oreum.length} 오름 · ${pct}%</span>` +
      `<span style="color:var(--dim);font-size:12px">탐방 가능 오름 기준</span>` +
      `<span class="bar"><i style="width:${pct}%"></i></span>`;

    const sorted = oreum.slice().sort((a, b) => {
      const da = visited.has(String(a.i)), db2 = visited.has(String(b.i));
      if (da !== db2) return da ? 1 : -1;              // 안 간 것 먼저
      if (here) return C.distance(here.lat, here.lon, a.lat, a.lon) - C.distance(here.lat, here.lon, b.lat, b.lon);
      return a.n.localeCompare(b.n, 'ko');
    });
    $('oreumList').innerHTML = sorted.map((o) => {
      const d = visited.has(String(o.i));
      const dist = here ? C.distance(here.lat, here.lon, o.lat, o.lon) : null;
      const sub = [o.d, C.altLabel(o.alt), o.p ? '주차장' : '', o.t ? '화장실' : ''].filter(Boolean).join(' · ');
      return `<button class="item" data-sug="${o.i}" data-kind="oreum">
        <span class="ico">${d ? '✅' : '⛰'}</span>
        <span class="body"><span class="nm">${esc(o.n)}</span><span class="sub">${esc(sub)}</span></span>
        <span class="rt">${dist != null ? C.distLabel(dist) : ''}</span>
      </button>`;
    }).join('');
  }

  function renderAll() {
    renderVerdict();
    renderMap();
    renderSuggest();
    if ($('q').value.trim()) renderResults(); else renderLog();
    renderOreumList();
    renderCharts();
  }

  /* ═══════════ 기록 시트 ═══════════ */

  function openSheet(init) {
    init = init || {};
    sheetMode = init.id || 'new';
    draft = {
      id: init.id || null,
      kind: init.kind || 'spot',
      name: init.name || '',
      date: init.date || C.todayStr(),
      lat: init.lat == null ? (here ? here.lat : null) : init.lat,
      lon: init.lon == null ? (here ? here.lon : null) : init.lon,
      oreumId: init.oreumId == null ? null : init.oreumId,
      note: init.note || '',
      photo: init.photo || null,
    };
    $('sheetTitle').textContent = init.id ? '기록 고치기' : '다녀온 곳';
    $('sName').value = draft.name;
    $('sDate').value = draft.date;
    $('sNote').value = draft.note;
    $('sDel').hidden = !init.id;
    setPhoto(draft.photo);
    paintKinds();
    paintGeo();
    $('sHint').textContent = '';
    $('sheet').hidden = false;
    if (!draft.name) setTimeout(() => $('sName').focus(), 80);
  }

  function closeSheet() { $('sheet').hidden = true; sheetMode = null; draft = null; }

  function paintKinds() {
    $('kindPick').innerHTML = C.KINDS.map((k) =>
      `<button data-kind="${k.v}" class="${draft.kind === k.v ? 'on' : ''}"><i>${k.icon}</i>${k.label}</button>`
    ).join('');
  }

  function paintGeo() {
    const none = draft.lat == null;
    $('sGeo').textContent = none ? '없음 — 지도에 안 찍힘'
      : `${draft.lat.toFixed(5)}, ${draft.lon.toFixed(5)}`;
    $('sGeo').style.color = none ? 'var(--warn)' : 'var(--dim)';
  }

  function setPhoto(dataUrl) {
    draft.photo = dataUrl || null;
    $('sPhoto').hidden = !dataUrl;
    $('sPhotoDel').hidden = !dataUrl;
    if (dataUrl) $('sPhoto').src = dataUrl;
  }

  function snapNow() {
    const lun = C.lunar(new Date());
    const cur = wx ? wx.hours[nowIndex(wx.hours.map((h) => h.time))] : null;
    const nt = wx && wx.tides.length ? C.nextTide(wx.tides, new Date()) : null;
    return {
      temp: cur ? Math.round(cur.temp) : null,
      wind: cur ? Math.round(cur.wind) : null,
      sky: cur ? (cur.cloud >= 80 ? '흐림' : cur.cloud >= 40 ? '구름' : '맑음') : null,
      multtae: C.multtae(lun.day),
      tide: nt ? `${nt.type === 'high' ? '만조' : '간조'} ${nt.t}` : null,
    };
  }

  function saveSheet() {
    if (!draft) return;
    const name = $('sName').value.trim();
    if (!name) { $('sHint').textContent = '이름을 적어주세요'; $('sName').focus(); return; }

    draft.name = name;
    draft.date = $('sDate').value || C.todayStr();
    draft.note = $('sNote').value.trim();

    if (sheetMode === 'new') {
      const v = C.makeVisit(Object.assign({}, draft, { snap: snapNow() }));
      S.visits.push(v);
      toast(`${name} 기록했습니다`);
    } else {
      const i = S.visits.findIndex((x) => x.id === sheetMode);
      if (i >= 0) {
        S.visits[i] = Object.assign({}, S.visits[i], {
          name: draft.name, kind: draft.kind, date: draft.date,
          note: draft.note, photo: draft.photo,
          lat: draft.lat, lon: draft.lon, oreumId: draft.oreumId,
        });
        toast('고쳤습니다');
      }
    }
    save();
    buzz();
    closeSheet();
    $('q').value = '';
    renderAll();
  }

  function deleteVisit(id) {
    const i = S.visits.findIndex((x) => x.id === id);
    if (i < 0) return;
    const gone = S.visits[i];
    S.visits.splice(i, 1);
    save();
    renderAll();
    showUndo(`${gone.name} 지웠습니다`, () => {
      S.visits.splice(i, 0, gone);
      save(); renderAll();
      toast('되돌렸습니다');
    });
  }

  /* ═══════════ 위치 ═══════════ */

  function locate(quiet) {
    if (!navigator.geolocation) { if (!quiet) toast('이 기기는 위치를 못 씁니다'); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      here = { lat: p.coords.latitude, lon: p.coords.longitude };
      if (map) map.setView([here.lat, here.lon], Math.max(map.getZoom(), 13));
      renderMap(); renderSuggest(); renderOreumList();
      if (!quiet) toast('현재 위치로 옮겼습니다');
      refreshWeather();
    }, (err) => {
      if (!quiet) toast('위치를 못 받았습니다 (' + (err.message || '') + ')');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  /* ═══════════ 내보내기 ═══════════ */

  function exportCSV() {
    if (!S.visits.length) { toast('내보낼 기록이 없습니다'); return; }
    const blob = new Blob([C.toCSV(S.visits)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `오늘나가_${C.todayStr().replace(/-/g, '')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast(`${S.visits.length}건 내보냈습니다`);
  }

  /* ═══════════ 배선 ═══════════ */

  function goTab(name) {
    document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + name));
    if (name === 'map' && map) setTimeout(() => map.invalidateSize(), 60);
  }

  function oreumById(id) { return oreum.find((o) => String(o.i) === String(id)); }

  function bind() {
    document.querySelectorAll('#tabbar button').forEach((b) => {
      b.onclick = () => { goTab(b.dataset.tab); buzz(); };
    });

    $('fab').onclick = () => { openSheet({}); buzz(); };
    $('sheetClose').onclick = closeSheet;
    document.querySelector('.sheetBack').onclick = closeSheet;
    $('sSave').onclick = saveSheet;
    $('sDel').onclick = () => { const id = sheetMode; closeSheet(); deleteVisit(id); };

    $('kindPick').onclick = (e) => {
      const b = e.target.closest('button[data-kind]');
      if (!b || !draft) return;
      draft.kind = b.dataset.kind;
      paintKinds();
      buzz();
    };

    $('sGeoBtn').onclick = () => {
      if (!navigator.geolocation) { $('sHint').textContent = '위치를 못 씁니다'; return; }
      $('sHint').textContent = '위치 잡는 중…';
      navigator.geolocation.getCurrentPosition((p) => {
        draft.lat = p.coords.latitude; draft.lon = p.coords.longitude;
        here = { lat: draft.lat, lon: draft.lon };
        paintGeo();
        $('sHint').textContent = '현재 위치로 맞췄습니다';
        $('sHint').className = 'hint ok';
      }, () => { $('sHint').textContent = '위치를 못 받았습니다'; $('sHint').className = 'hint'; },
        { enableHighAccuracy: true, timeout: 12000 });
    };

    $('sPhotoBtn').onclick = () => $('sPhotoFile').click();
    $('sPhotoDel').onclick = () => setPhoto(null);
    $('sPhotoFile').onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      shrinkImage(f, 900, 0.72).then(setPhoto).catch(() => toast('사진을 못 읽었습니다'));
      e.target.value = '';
    };

    $('q').oninput = renderResults;
    $('q').onfocus = () => { if ($('q').value) $('q').select(); };
    $('qClear').onclick = () => { $('q').value = ''; renderResults(); $('q').focus(); };

    $('btnLocate').onclick = () => locate(false);
    $('vRetry').onclick = () => refreshWeather(true);
    $('undoBtn').onclick = () => {
      if (lastDeleted) lastDeleted();
      lastDeleted = null; $('undo').hidden = true; clearTimeout(undoTimer);
    };

    // 목록·추천·지도 팝업에서 오는 클릭을 한 곳에서 받는다
    document.body.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) {
        e.preventDefault();
        const o = oreumById(go.dataset.go);
        if (o) openSheet({ kind: 'oreum', name: o.n, oreumId: o.i, lat: o.lat, lon: o.lon });
        return;
      }
      const sug = e.target.closest('[data-sug]');
      if (sug) {
        const o = oreumById(sug.dataset.sug);
        if (o) openSheet({ kind: 'oreum', name: o.n, oreumId: o.i, lat: o.lat, lon: o.lon });
        else openSheet({ kind: sug.dataset.kind || 'spot' });
        buzz();
        return;
      }
      const vid = e.target.closest('[data-vid]');
      if (vid) {
        const v = S.visits.find((x) => x.id === vid.dataset.vid);
        if (v) openSheet(v);
        buzz();
      }
    });
  }

  /** 사진은 긴 변 기준으로 줄여 저장한다. 원본을 그대로 넣으면 저장공간이 금방 찬다. */
  function shrinkImage(file, maxSide, quality) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onerror = rej;
      fr.onload = () => {
        const img = new Image();
        img.onerror = rej;
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * scale);
          cv.height = Math.round(img.height * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          res(cv.toDataURL('image/jpeg', quality));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ═══════════ 시작 ═══════════ */

  async function refreshWeather(loud) {
    const at = here || JEJU;
    try {
      wx = await fetchWeather(at.lat.toFixed(3), at.lon.toFixed(3));
      if (loud) toast('날씨를 새로 받았습니다');
    } catch (e) {
      wx = cachedWx();
      if (loud) toast('날씨를 못 받았습니다' + (wx ? ' (저장된 값 사용)' : ''));
    }
    renderVerdict();
    renderSuggest();
    renderCharts();   // 날씨가 늦게 도착한다. 이걸 빠뜨리면 물때·기온 그래프가 영영 안 뜬다.
  }

  async function start() {
    load();
    bind();
    wx = cachedWx();

    try {
      const r = await fetch('data/oreum.json');
      const d = await r.json();
      oreum = d.oreum || [];
    } catch (e) {
      oreum = [];
      toast('오름 목록을 못 읽었습니다');
    }

    initMap();
    renderAll();
    fitAll();
    locate(true);
    refreshWeather(false);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    window.addEventListener('online', () => refreshWeather(false));
  }

  // 테스트에서 들여다볼 수 있게 최소한만 연다
  window.ONApp = {
    get state() { return S; },
    get wx() { return wx; },
    set wx(v) { wx = v; },
    get oreum() { return oreum; },
    set oreum(v) { oreum = v; },
    set here(v) { here = v; },
    get here() { return here; },
    renderAll, renderVerdict, renderLog, renderResults, renderOreumList, renderSuggest, renderCharts,
    openSheet, closeSheet, saveSheet, deleteVisit, goTab, exportCSV, load, save,
    get draft() { return draft; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
