/* 오늘 나가? — 순수 로직 (브라우저/Node 공용)
 * DOM·저장소·네트워크에 의존하지 않는 부분만 둔다. Node에서 그대로 테스트한다.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.ONCore = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ─────────────── 검색 키 ─────────────── */

  /** 검색 키 정규화: 소문자 + 영숫자/한글만 남김. */
  function norm(s) {
    if (!s) return '';
    return String(s).normalize('NFC').toLowerCase()
      .replace(/[^0-9a-z\uac00-\ud7a3\u3131-\u318e]/g, '');
  }

  const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

  /** 초성 추출. '국수' -> 'ㄱㅅ' */
  function chosung(s) {
    let out = '';
    for (const ch of String(s || '')) {
      const c = ch.charCodeAt(0);
      if (c >= 0xac00 && c <= 0xd7a3) out += CHO[Math.floor((c - 0xac00) / 588)];
      else out += ch;
    }
    return out;
  }

  function isChosungQuery(q) {
    return q.length > 0 && /^[\u3131-\u314e]+$/.test(q);
  }

  /* ─────────────── 음력 · 물때 ─────────────── */

  /**
   * 그레고리력 → 음력 일(1~30). Intl 중국력(=음력과 같은 삭망월)을 쓴다.
   * @returns {{month:number, day:number, leap:boolean}}
   */
  function lunar(date) {
    const fmt = new Intl.DateTimeFormat('en-u-ca-chinese', {
      day: 'numeric', month: 'numeric', timeZone: 'Asia/Seoul',
    });
    const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
    const rawMonth = String(parts.month);
    return {
      month: parseInt(rawMonth, 10),
      day: parseInt(parts.day, 10),
      leap: /bis/i.test(rawMonth),
    };
  }

  /* 8물때식(제주·남해·동해): 음력 1일=8물 … 8일=조금 … 9일=1물 …
   * 16일부터 같은 주기가 반복된다. 출처: 국립해양조사원 물때 관행표기. */
  const MULTTAE_8 = ['8물','9물','10물','11물','12물','13물','14물','조금',
                     '1물','2물','3물','4물','5물','6물','7물'];

  /**
   * 음력 일자 → 물때 이름 (8물때식).
   * @param {number} lunarDay 1~30
   */
  function multtae(lunarDay) {
    const d = Number(lunarDay);
    if (!Number.isFinite(d) || d < 1 || d > 30) return '';
    const idx = (d - 1) % 15;          // 1~15 / 16~30 동일 주기
    return MULTTAE_8[idx];
  }

  /** 물때의 센 정도 0(조금)~1(사리). 갯바위·해루질 판단용. */
  function multtaeStrength(name) {
    if (name === '조금') return 0;
    const m = /^(\d+)물$/.exec(name || '');
    if (!m) return 0.5;
    const n = parseInt(m[1], 10);       // 1물(약)~14물(강) 순으로 커진다
    return Math.min(1, Math.max(0, n / 14));
  }

  /**
   * 달 밝기(조명비) 근사. 음력일 기준 코사인 모델 — 천문 계산이 아닌 근사값이다.
   * @returns {number} 0(삭)~1(망)
   */
  function moonIllum(lunarDay) {
    const d = Number(lunarDay);
    if (!Number.isFinite(d)) return 0;
    const phase = ((d - 1) % 29.53059) / 29.53059;   // 0=삭
    return (1 - Math.cos(2 * Math.PI * phase)) / 2;
  }

  function moonLabel(illum) {
    if (illum < 0.05) return '삭';
    if (illum < 0.45) return '초승/그믐';
    if (illum < 0.55) return '반달';
    if (illum < 0.95) return '상현/하현';
    return '보름';
  }

  /* ─────────────── 조위 극값 ─────────────── */

  /**
   * 시간별 조위 배열에서 고조·저조를 찾는다.
   * 꼭짓점은 3점 포물선 보간으로 분 단위까지 좁힌다.
   * @param {string[]} times ISO 로컬시각 ('2026-09-24T14:00')
   * @param {number[]} heights 조위(m)
   * @returns {Array<{t:string, iso:string, h:number, type:'high'|'low'}>}
   */
  function tideExtremes(times, heights) {
    const out = [];
    if (!times || !heights || times.length < 3) return out;
    for (let i = 1; i < heights.length - 1; i++) {
      const a = heights[i - 1], b = heights[i], c = heights[i + 1];
      if (a == null || b == null || c == null) continue;
      const isHigh = b > a && b >= c;
      const isLow = b < a && b <= c;
      if (!isHigh && !isLow) continue;

      // 포물선 꼭짓점 오프셋(시간 단위, -0.5~0.5)
      const denom = a - 2 * b + c;
      const off = denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denom));
      const peak = denom === 0 ? b : b - 0.25 * (a - c) * off;

      const base = new Date(times[i] + (times[i].length === 16 ? ':00' : ''));
      const at = new Date(base.getTime() + off * 3600 * 1000);
      out.push({
        iso: times[i],
        t: hhmm(at),
        h: Math.round(peak * 100) / 100,
        type: isHigh ? 'high' : 'low',
        at: at,
      });
    }
    return out;
  }

  function hhmm(d) {
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /** 극값의 at을 Date로 되돌린다. localStorage를 거치면 문자열이 되기 때문이다. */
  function reviveTide(e) {
    if (!e) return null;
    if (e.at instanceof Date) return e;
    const at = new Date(e.at || e.iso);
    return Number.isNaN(at.getTime()) ? null : Object.assign({}, e, { at: at });
  }

  /** 극값 목록에서 기준시각 이후 가장 가까운 것 */
  function nextTide(extremes, now) {
    const t = now ? now.getTime() : Date.now();
    return (extremes || [])
      .map(reviveTide)
      .filter((e) => e && e.at.getTime() >= t)
      .sort((a, b) => a.at - b.at)[0] || null;
  }

  /* ─────────────── 나들이 점수 ─────────────── */

  const SCORE_LABEL = ['별로', '아쉬움', '무난', '좋음', '아주 좋음', '최고'];

  /**
   * 시간별 날씨로 나들이 점수(0~5)와 이유를 낸다.
   * @param {{rain:number, wind:number, cloud:number, temp:number}} h
   */
  function hourScore(h) {
    let s = 5;
    const why = [];
    const rain = Number(h.rain) || 0;
    const wind = Number(h.wind) || 0;
    const cloud = Number(h.cloud) || 0;
    const temp = Number(h.temp);

    if (rain >= 60) { s -= 3; why.push('비 올 확률 높음'); }
    else if (rain >= 30) { s -= 1.5; why.push('비 올 수 있음'); }

    if (wind >= 10) { s -= 2; why.push('바람 강함'); }
    else if (wind >= 7) { s -= 1; why.push('바람 있음'); }

    if (cloud >= 85) { s -= 0.5; why.push('흐림'); }

    if (Number.isFinite(temp)) {
      if (temp >= 33 || temp <= 0) { s -= 2; why.push(temp >= 33 ? '너무 더움' : '너무 추움'); }
      else if (temp >= 30 || temp <= 4) { s -= 1; why.push(temp >= 30 ? '더움' : '추움'); }
    }
    return { score: Math.max(0, Math.min(5, Math.round(s * 2) / 2)), why: why };
  }

  /**
   * 하루치 시간별 날씨에서 활동시간(기본 08~19시) 판정을 낸다.
   * 전체 점수는 '대부분의 시간이 어떤가'를 따르고(중앙값),
   * 특정 시간대만 좋으면 그 시각을 따로 알려준다.
   * @returns {{score:number, label:string, bestFrom:string|null, why:string[]}}
   */
  function dayVerdict(hours, opt) {
    opt = opt || {};
    const from = opt.from == null ? 8 : opt.from;
    const to = opt.to == null ? 19 : opt.to;
    const inDay = hours.filter((h) => {
      const hr = Number(h.time.slice(11, 13));
      return hr >= from && hr <= to;
    });
    if (!inDay.length) return { score: 0, label: SCORE_LABEL[0], bestFrom: null, bestScore: 0, why: ['자료 없음'] };

    const scored = inDay.map((h) => Object.assign({ time: h.time }, hourScore(h)));

    // 전체 점수 = 중앙값과 평균 중 낮은 쪽.
    // 중앙값만 쓰면 절반이 폭우여도 '최고'가 되고,
    // 평균만 쓰면 한두 시간 나쁜 것이 하루 전체를 끌어내린다.
    const sortedScores = scored.map((x) => x.score).sort((a, b) => a - b);
    const mid = sortedScores.length % 2
      ? sortedScores[(sortedScores.length - 1) / 2]
      : (sortedScores[sortedScores.length / 2 - 1] + sortedScores[sortedScores.length / 2]) / 2;
    const avg = scored.reduce((a, x) => a + x.score, 0) / scored.length;
    const overall = Math.round(Math.min(mid, avg) * 2) / 2;

    // 좋아지는 구간: 전체보다 뚜렷이 나은 점수가 처음 나오고, 그 뒤로 이어지는 시각
    const best = scored.reduce((m, x) => (x.score > m.score ? x : m), scored[0]);
    let bestFrom = null;
    if (best.score >= overall + 1) {
      for (let i = 0; i < scored.length; i++) {
        if (scored[i].score >= best.score - 0.001) {
          const rest = scored.slice(i);
          if (rest.every((x) => x.score >= overall + 0.5)) { bestFrom = scored[i].time; break; }
        }
      }
    }

    // 이유는 '나쁜 쪽' 시간대에서 자주 나온 것 위주
    const tally = new Map();
    scored.filter((x) => x.score <= overall + 0.001)
      .forEach((x) => x.why.forEach((w) => tally.set(w, (tally.get(w) || 0) + 1)));
    const why = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map((e) => e[0]);

    return {
      score: overall,
      // 3.5점을 '아주 좋음'으로 올리지 않는다. 애매하면 낮은 쪽을 말한다.
      label: SCORE_LABEL[Math.floor(overall)] || SCORE_LABEL[0],
      bestFrom: bestFrom ? bestFrom.slice(11, 16) : null,
      bestScore: best.score,
      why: why.length ? why : ['날씨 무난'],
    };
  }

  /* ─────────────── 거리 ─────────────── */

  /** 두 좌표 사이 거리(m). 하버사인. */
  function distance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
  }

  /** 표고 표기. 200.5 -> '201m'. 원본에 값이 없는 둘레길 등(0·null)은 표기하지 않는다. */
  function altLabel(v) {
    const n = Number(v);
    return v == null || !Number.isFinite(n) || n <= 0 ? '' : Math.round(n) + 'm';
  }

  /**
   * 화면에서 가까운 점들을 하나로 묶는다. 제주 전체를 폰 화면에 넣으면
   * 오름 69개가 겹쳐 어느 것인지 알 수 없기 때문이다.
   * @param {Array} pts - {x, y, ...} 화면 픽셀 좌표
   * @param {number} px - 이 거리 안이면 같은 묶음 (기본 34px, 손가락 굵기)
   * @returns {Array} [{x, y, items:[...]}] — items가 1개면 낱개
   */
  function clusterByPixel(pts, px) {
    const R = px == null ? 34 : px;
    const out = [];
    (pts || []).forEach((p) => {
      let hit = null;
      for (let i = 0; i < out.length; i++) {
        const c = out[i];
        if (Math.hypot(c.x - p.x, c.y - p.y) <= R) { hit = c; break; }
      }
      if (hit) {
        hit.items.push(p);
        // 묶음 중심을 평균으로 옮긴다
        hit.x = hit.items.reduce((s, q) => s + q.x, 0) / hit.items.length;
        hit.y = hit.items.reduce((s, q) => s + q.y, 0) / hit.items.length;
      } else {
        out.push({ x: p.x, y: p.y, items: [p] });
      }
    });
    return out;
  }

  /* ═══════ 그래프용 계산 (SVG 좌표까지만, 그리기는 app.js) ═══════ */

  /**
   * 시계열을 그래프 좌표로 바꾼다.
   * @param {Array} rows - {time, v} 형태. v가 null이면 그 점은 건너뛴다.
   * @param {Object} box - {w, h, pad} 그릴 상자 크기
   * @returns {{pts:Array, min:number, max:number, xOf:Function, yOf:Function}|null}
   */
  function plot(rows, box) {
    const b = Object.assign({ w: 340, h: 90, pad: 6 }, box || {});
    const ok = (rows || []).filter((r) => r && r.v != null && Number.isFinite(r.v));
    if (ok.length < 2) return null;

    const vs = ok.map((r) => r.v);
    let min = Math.min(...vs), max = Math.max(...vs);
    if (min === max) { min -= 1; max += 1; }          // 평평한 값도 그려지게
    const t0 = new Date(ok[0].time).getTime();
    const t1 = new Date(ok[ok.length - 1].time).getTime();
    const span = t1 - t0 || 1;

    const xOf = (t) => {
      const ms = (t instanceof Date ? t.getTime() : new Date(t).getTime());
      return b.pad + ((ms - t0) / span) * (b.w - b.pad * 2);
    };
    const yOf = (v) => b.pad + (1 - (v - min) / (max - min)) * (b.h - b.pad * 2);

    return {
      pts: ok.map((r) => ({ x: xOf(r.time), y: yOf(r.v), v: r.v, time: r.time })),
      min: min, max: max, t0: t0, t1: t1, box: b, xOf: xOf, yOf: yOf,
    };
  }

  /**
   * 그래프 라벨을 어디에 붙일지 정한다.
   * 가운데 정렬만 쓰면 양 끝 라벨이 그래프 밖으로 잘린다.
   * @returns {{anchor:string, x:number}}
   */
  function labelAnchor(x, width, half) {
    const hw = half == null ? 18 : half;
    if (x - hw < 0) return { anchor: 'start', x: 1 };
    if (x + hw > width) return { anchor: 'end', x: width - 1 };
    return { anchor: 'middle', x: x };
  }

  /** 점들을 부드러운 곡선 path로. 조위는 각지면 어색하다. */
  function smoothPath(pts) {
    if (!pts || pts.length < 2) return '';
    let d = `M${r2(pts[0].x)},${r2(pts[0].y)}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      const mx = (p.x + q.x) / 2;
      d += `C${r2(mx)},${r2(p.y)} ${r2(mx)},${r2(q.y)} ${r2(q.x)},${r2(q.y)}`;
    }
    return d;
  }

  function r2(n) { return Math.round(n * 10) / 10; }

  /** 하루 24칸으로 접는다. 막대그래프(기온·비·바람)용. */
  function byHour(rows, dayStr) {
    const out = [];
    (rows || []).forEach((r) => {
      if (dayStr && String(r.time).slice(0, 10) !== dayStr) return;
      const hh = Number(String(r.time).slice(11, 13));
      if (!Number.isFinite(hh)) return;
      out.push(Object.assign({ hour: hh }, r));
    });
    return out;
  }

  /**
   * 기록을 달력 히트맵용으로 센다.
   * @returns {Map} 'YYYY-MM-DD' -> 건수
   */
  function countByDate(visits) {
    const m = new Map();
    (visits || []).forEach((v) => {
      if (!v || !v.date) return;
      m.set(v.date, (m.get(v.date) || 0) + 1);
    });
    return m;
  }

  /** 월별 집계. 막대그래프용. */
  function countByMonth(visits) {
    const m = new Map();
    (visits || []).forEach((v) => {
      if (!v || !v.date) return;
      const k = String(v.date).slice(0, 7);
      m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, n]) => ({ month: month, n: n }));
  }

  /** 읍면동별 오름 정복 현황. */
  function oreumByArea(oreum, visits) {
    const done = new Set((visits || []).filter((v) => v.oreumId != null).map((v) => String(v.oreumId)));
    const m = new Map();
    (oreum || []).forEach((o) => {
      const k = o.d || '기타';
      const c = m.get(k) || { area: k, total: 0, done: 0 };
      c.total++;
      if (done.has(String(o.i))) c.done++;
      m.set(k, c);
    });
    return [...m.values()].sort((a, b) => b.total - a.total);
  }

  function distLabel(m) {
    if (m == null) return '';
    if (m < 1000) return m + 'm';
    return (m / 1000).toFixed(m < 10000 ? 1 : 0) + 'km';
  }

  /* ─────────────── 장소 검색 ─────────────── */

  const KINDS = [
    { v: 'oreum', label: '오름', icon: '⛰' },
    { v: 'food', label: '먹은곳', icon: '🍚' },
    { v: 'sea', label: '바다', icon: '🌊' },
    { v: 'spot', label: '그밖에', icon: '📍' },
  ];
  const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.v, k.label]));
  const KIND_ICON = Object.fromEntries(KINDS.map((k) => [k.v, k.icon]));

  /**
   * 내 기록 + 오름 목록을 한 번에 검색한다.
   * 점수: 완전일치 > 접두 > 초성 > 부분포함. 내 기록이 같은 점수면 앞에 온다.
   * @param {{visits:Array, oreum:Array}} db
   * @returns {Array<{kind:string, name:string, mine:boolean, ...}>}
   */
  function searchPlaces(db, query, limit) {
    limit = limit || 30;
    const q = norm(query);
    if (!q) return [];
    const useCho = isChosungQuery(query.trim());
    const qc = query.trim();
    const hits = [];

    const rank = (name) => {
      const nk = norm(name);
      if (nk === q) return 100;
      if (nk.startsWith(q)) return 80;
      if (useCho && chosung(name).startsWith(qc)) return 70;
      if (useCho && chosung(name).includes(qc)) return 55;
      if (nk.includes(q)) return 50;
      return 0;
    };

    // 1) 내 기록 — 같은 장소는 방문횟수로 합친다
    const byPlace = new Map();
    (db.visits || []).forEach((v) => {
      const key = norm(v.name) + '|' + v.kind;
      const cur = byPlace.get(key);
      if (cur) {
        cur.count += 1;
        if (v.date > cur.last) { cur.last = v.date; cur.lat = v.lat; cur.lon = v.lon; }
      } else {
        byPlace.set(key, {
          kind: v.kind, name: v.name, mine: true, count: 1,
          last: v.date, lat: v.lat, lon: v.lon, id: v.id,
        });
      }
    });
    byPlace.forEach((p) => {
      const r = rank(p.name);
      if (r > 0) hits.push({ r: r + 5, p: p });      // 내 기록 가산점
    });

    // 2) 아직 안 간 오름
    const visited = new Set((db.visits || [])
      .filter((v) => v.oreumId != null).map((v) => String(v.oreumId)));
    (db.oreum || []).forEach((o) => {
      if (visited.has(String(o.i))) return;           // 간 곳은 위에서 이미 나옴
      const r = rank(o.n);
      if (r > 0) {
        hits.push({
          r: r,
          p: { kind: 'oreum', name: o.n, mine: false, count: 0,
               lat: o.lat, lon: o.lon, oreumId: o.i, alt: o.alt, area: o.d },
        });
      }
    });

    hits.sort((a, b) => b.r - a.r || a.p.name.length - b.p.name.length);
    return hits.slice(0, limit).map((h) => h.p);
  }

  /* ─────────────── 추천 ─────────────── */

  /**
   * 오늘 갈 만한 곳을 고른다.
   * - 안 가본 오름 우선, 가까운 순
   * - 바다는 저조 전후 2시간에만
   * @param {{oreum:Array, visits:Array}} db
   * @param {{lat:number, lon:number}|null} here
   * @param {{lowTide:Date|null, now:Date}} ctx
   */
  function suggest(db, here, ctx, limit) {
    limit = limit || 5;
    ctx = ctx || {};
    const now = ctx.now || new Date();
    const visited = new Set((db.visits || [])
      .filter((v) => v.oreumId != null).map((v) => String(v.oreumId)));

    const list = (db.oreum || [])
      .filter((o) => !visited.has(String(o.i)))
      .map((o) => {
        const d = here ? distance(here.lat, here.lon, o.lat, o.lon) : null;
        return {
          kind: 'oreum', name: o.n, oreumId: o.i, lat: o.lat, lon: o.lon,
          alt: o.alt, area: o.d, parking: o.p, toilet: o.t,
          dist: d, why: [],
        };
      });

    list.forEach((x) => {
      if (x.dist != null && x.dist < 15000) x.why.push('가까움');
      if (x.parking) x.why.push('주차장');
      if (x.alt != null && x.alt > 0 && x.alt <= 150) x.why.push('낮음');
    });

    list.sort((a, b) => {
      if (a.dist != null && b.dist != null) return a.dist - b.dist;
      return a.name.localeCompare(b.name, 'ko');
    });

    const out = list.slice(0, limit);

    // 저조 전후 2시간이면 바다도 권한다
    if (ctx.lowTide) {
      const gap = Math.abs(ctx.lowTide.getTime() - now.getTime()) / 3600000;
      if (gap <= 2) {
        out.unshift({
          kind: 'sea', name: '바다 나가기 좋은 때',
          why: ['간조 ' + hhmm(ctx.lowTide) + ' 전후'],
          dist: null, tideHint: true,
        });
      }
    }
    return out;
  }

  /* ─────────────── 기록 ─────────────── */

  function todayStr(d) {
    const x = d || new Date();
    return x.getFullYear() + '-' +
      String(x.getMonth() + 1).padStart(2, '0') + '-' +
      String(x.getDate()).padStart(2, '0');
  }

  let idSeq = 0;
  /** 같은 밀리초에 여러 번 불려도 겹치지 않는다 (연속 카운터를 붙인다). */
  function newId() {
    return Date.now().toString(36) + '-' + (idSeq++).toString(36);
  }

  /**
   * 방문 기록 하나를 만든다. 날씨·물때는 찍은 그 순간 값을 박아둔다.
   */
  function makeVisit(input) {
    const now = input.now || new Date();
    return {
      id: input.id || newId(),
      kind: input.kind || 'spot',
      name: (input.name || '').trim(),
      date: input.date || todayStr(now),
      time: hhmm(now),
      lat: input.lat == null ? null : Number(input.lat),
      lon: input.lon == null ? null : Number(input.lon),
      oreumId: input.oreumId == null ? null : input.oreumId,
      note: input.note || '',
      photo: input.photo || null,
      snap: input.snap || null,          // {temp, wind, sky, multtae, tide}
      ts: now.getTime(),
    };
  }

  /** 월별·종류별 집계 */
  function summarize(visits) {
    const byKind = {};
    KINDS.forEach((k) => { byKind[k.v] = 0; });
    const byMonth = new Map();
    const oreumSet = new Set();
    (visits || []).forEach((v) => {
      if (byKind[v.kind] != null) byKind[v.kind] += 1;
      const m = (v.date || '').slice(0, 7);
      if (m) byMonth.set(m, (byMonth.get(m) || 0) + 1);
      if (v.oreumId != null) oreumSet.add(String(v.oreumId));
    });
    return {
      total: (visits || []).length,
      byKind: byKind,
      oreumDone: oreumSet.size,
      months: [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])),
    };
  }

  /** 내보내기 CSV (엑셀에서 바로 열린다) */
  const CRLF = String.fromCharCode(13, 10);
  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(visits) {
    const head = ['날짜', '시각', '종류', '이름', '위도', '경도', '기온', '바람', '하늘', '물때', '메모'];
    const lines = [head.map(csvCell).join(',')];
    (visits || []).slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .forEach((v) => {
        const s = v.snap || {};
        lines.push([v.date, v.time, KIND_LABEL[v.kind] || v.kind, v.name,
          v.lat, v.lon, s.temp, s.wind, s.sky, s.multtae, v.note].map(csvCell).join(','));
      });
    return '\ufeff' + lines.join(CRLF);
  }

  return {
    norm, chosung, isChosungQuery,
    lunar, multtae, multtaeStrength, MULTTAE_8, moonIllum, moonLabel,
    tideExtremes, nextTide, reviveTide, hhmm,
    hourScore, dayVerdict, SCORE_LABEL,
    distance, distLabel, altLabel, clusterByPixel,
    plot, smoothPath, labelAnchor, byHour, countByDate, countByMonth, oreumByArea,
    KINDS, KIND_LABEL, KIND_ICON, searchPlaces, suggest,
    todayStr, newId, makeVisit, summarize, toCSV, csvCell,
  };
});
