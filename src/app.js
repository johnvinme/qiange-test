/* ============================================================
 * app.js — 钱格测试 交互框架 v3（复古游戏机 × 摆烂自嘲）
 * 合原型音效/转场/滑块 + 分享链路
 * ============================================================ */
(function () {
  const { CALC_QUESTIONS, PERSONALITY_QUESTIONS, SCALE_QUESTIONS, PERSONALITIES, CITY_META } = window.QGContent;
  const root = document.getElementById('app');

  const state = {
    stage: 'intro',
    shared: false,
    idx: 0,
    calc: {},
    answers: {},
    result: null,
  };
  CALC_QUESTIONS.forEach(q => state.calc[q.key] = q.default);

  // 弹幕层常驻 body，切题不销毁
  const danmakuLayer = document.createElement('div');
  danmakuLayer.id = 'danmaku-layer';
  document.body.appendChild(danmakuLayer);

  /* ============================================================
     ♪ Chiptune 音效引擎 —— Web Audio 纯合成，零文件
     ============================================================ */
  const SFX = (() => {
    let ctx = null, masterOn = false, bgmTimer = null;
    function ac() { if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); } return ctx; }
    function note(f, t, { type = 'square', vol = 0.18, when = 0, slideTo = null } = {}) {
      if (!masterOn) return;
      const c = ac(); const o = c.createOscillator(); const g = c.createGain();
      o.type = type; const start = c.currentTime + when;
      o.frequency.setValueAtTime(f, start);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + t);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(vol, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + t);
      o.connect(g); g.connect(c.destination); o.start(start); o.stop(start + t + 0.02);
    }
    function chord(freqs, t, opt) { freqs.forEach(f => note(f, t, opt)); }
    const lib = {
      tap: () => note(440, 0.06, { type: 'square', vol: 0.12 }),
      press: () => { note(330, 0.05, { vol: 0.14 }); note(495, 0.07, { when: 0.04, vol: 0.12 }); },
      tick: () => note(880, 0.025, { type: 'square', vol: 0.05 }),
      select: () => { note(660, 0.06, { vol: 0.13 }); note(880, 0.08, { when: 0.05, vol: 0.13 }); },
      moodUp: () => note(784, 0.07, { type: 'triangle', vol: 0.1, slideTo: 1046 }),
      moodDown: () => note(392, 0.09, { type: 'triangle', vol: 0.1, slideTo: 262 }),
      flip: () => { note(587, 0.05, { vol: 0.12 }); note(784, 0.07, { when: 0.05, vol: 0.12 }); },
      start: () => { [392, 523, 659, 784].forEach((f, i) => note(f, 0.1, { when: i * 0.07, vol: 0.14 })); },
      fanfare: () => { const seq = [523, 659, 784, 1046, 1318]; seq.forEach((f, i) => note(f, 0.14, { when: i * 0.09, vol: 0.16, type: 'square' })); chord([1046, 1318], 0.5, { when: seq.length * 0.09, vol: 0.12, type: 'triangle' }); },
      countTick: () => note(1200, 0.02, { type: 'square', vol: 0.06 }),
    };
    return {
      unlock() { ac().resume && ac().resume(); },
      setOn(v) { masterOn = v; if (!v && bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } },
      isOn() { return masterOn; },
      play(name) { (lib[name] || (() => { }))(); },
      bgmStart() {
        if (!masterOn || bgmTimer) return;
        const bass = [131, 131, 165, 147]; let step = 0;
        const beat = () => { if (!masterOn) return; const f = bass[step % bass.length]; note(f, 0.42, { type: 'triangle', vol: 0.06 }); if (step % 4 === 2) note(f * 4, 0.12, { type: 'square', vol: 0.03, when: 0.2 }); step++; };
        beat(); bgmTimer = setInterval(beat, 520);
      },
      bgmStop() { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } },
    };
  })();

  /* ============================================================
     分享编解码
     ============================================================ */
  function encodeResult(res) {
    const o = { c: res.dimensions.code, s: res.dimensions.scores,
      a: isFinite(res.retirement.achievableRetireAge) ? res.retirement.achievableRetireAge : null,
      m: isFinite(res.retirement.monthlySaveNeeded) ? res.retirement.monthlySaveNeeded : null,
      p: res.cityPercentile };
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    const binStr = String.fromCharCode(...bytes);
    return btoa(binStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeResult(str) {
    const binStr = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binStr, c => c.charCodeAt(0));
    const o = JSON.parse(new TextDecoder().decode(bytes));
    return { dimensions: { code: o.c, scores: o.s }, retirement: { achievableRetireAge: o.a, monthlySaveNeeded: o.m }, cityPercentile: o.p };
  }

  /* ============================================================
     题目流：5 计算 + 滑块 + 选择 + 城市（统一编号）
     ============================================================ */
  const FLOW = [
    ...CALC_QUESTIONS.map(q => ({ kind: 'calc', q })),
    // 穿插式：滑块 → 选择 → 滑块 → 选择，小人回嘴不断档
    ...SCALE_QUESTIONS.slice(0, 2).map(q => ({ kind: 'scale', q })),
    ...PERSONALITY_QUESTIONS.filter(q => q.type !== 'city').slice(0, 4).map(q => ({ kind: 'choice', q })),
    ...SCALE_QUESTIONS.slice(2, 4).map(q => ({ kind: 'scale', q })),
    ...PERSONALITY_QUESTIONS.filter(q => q.type !== 'city').slice(4, 7).map(q => ({ kind: 'choice', q })),
    ...SCALE_QUESTIONS.slice(4).map(q => ({ kind: 'scale', q })),
    ...PERSONALITY_QUESTIONS.filter(q => q.type !== 'city').slice(7).map(q => ({ kind: 'choice', q })),
    ...PERSONALITY_QUESTIONS.filter(q => q.type === 'city').map(q => ({ kind: 'choice', q, isCity: true })),
  ];
  const TOTAL = FLOW.length;

  /* ============================================================
     转场 / 渲染框架
     ============================================================ */
  function transition(renderFn) {
    const old = root.querySelector('.screen');
    if (old) { old.classList.add('leaving'); setTimeout(() => { renderFn(); }, 230); }
    else renderFn();
  }
  function screen(html) {
    root.innerHTML = `<div class="topbar"><div class="brand"><span class="logo-mark"><span class="dollar">$</span>BTI</span>&nbsp;<span class="logo-name">钱格测试</span><span class="byline">by zcw</span></div><button class="sound-toggle ${SFX.isOn() ? 'on' : ''}" id="sndBtn" aria-label="声音开关">${SFX.isOn() ? '🔊' : '🔇'}</button></div><div class="screen enter">${html}</div>`;
    const sb = document.getElementById('sndBtn');
    if (sb) sb.onclick = () => {
      const next = !SFX.isOn(); SFX.setOn(next);
      if (next) { SFX.unlock(); SFX.play('select'); SFX.bgmStart(); }
      else { SFX.bgmStop(); }
      sb.textContent = next ? '🔊' : '🔇'; sb.classList.toggle('on', next);
    };
  }

  function progressBar(i) { return `<div class="progress rise d1"><i style="width:${(i / TOTAL * 100).toFixed(0)}%"></i></div>`; }

  /* —— 表情脸 —— */
  function faceSVG(mood) {
    const F = {
      chill: { e: '<circle cx="36" cy="46" r="4"/><circle cx="64" cy="46" r="4"/>', m: '<path d="M38 64 Q50 70 62 64" fill="none" stroke-width="4" stroke-linecap="round"/>' },
      smug: { e: '<path d="M30 46 q6 -5 12 0"/><path d="M58 46 q6 -5 12 0"/>', m: '<path d="M36 62 Q52 74 64 60" fill="none" stroke-width="4" stroke-linecap="round"/>' },
      sneer: { e: '<path d="M30 44 q6 4 12 0"/><circle cx="64" cy="46" r="4"/>', m: '<path d="M38 66 q6 -8 12 0 q6 8 12 0" fill="none" stroke-width="4" stroke-linecap="round"/>' },
      sour: { e: '<circle cx="38" cy="44" r="4"/><circle cx="66" cy="44" r="4"/>', m: '<path d="M38 66 L62 66" stroke-width="4" stroke-linecap="round"/>' },
      cry: { e: '<circle cx="36" cy="46" r="6"/><circle cx="64" cy="46" r="6"/>', m: '<path d="M40 68 Q50 60 60 68" fill="none" stroke-width="4" stroke-linecap="round"/>', x: '<path d="M34 52 q-2 8 0 12" fill="none" stroke-width="3" opacity=".7"/>' },
      wow: { e: '<circle cx="36" cy="45" r="7"/><circle cx="64" cy="45" r="7"/>', m: '<ellipse cx="50" cy="66" rx="8" ry="10" fill="none" stroke-width="4"/>' },
      roll: { e: '<path d="M30 48 a6 6 0 0 1 12 0" fill="none" stroke-width="4"/><path d="M58 48 a6 6 0 0 1 12 0" fill="none" stroke-width="4"/>', m: '<path d="M38 66 L62 66" stroke-width="4" stroke-linecap="round"/>' },
      wink: { e: '<path d="M30 46 q6 4 12 0" fill="none" stroke-width="4"/><circle cx="64" cy="46" r="4"/>', m: '<path d="M36 60 Q52 74 66 60" fill="none" stroke-width="4" stroke-linecap="round"/>' },
      dead: { e: '<path d="M32 46 L42 46"/><path d="M58 46 L68 46"/>', m: '<path d="M38 66 L62 66" stroke-width="4" stroke-linecap="round"/>' },
      money: { e: '<text x="36" y="52" font-size="16" text-anchor="middle" stroke="none">$</text><text x="64" y="52" font-size="16" text-anchor="middle" stroke="none">$</text>', m: '<path d="M34 60 Q50 76 66 60 Q50 66 34 60" stroke-width="3"/>' },
    };
    const f = F[mood] || F.chill;
    return `<svg viewBox="0 0 100 100" class="face-svg" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="#FFD27D" stroke="#211C16" stroke-width="4"/><circle cx="30" cy="60" r="6" fill="#FF4D2E" opacity=".35" stroke="none"/><circle cx="70" cy="60" r="6" fill="#FF4D2E" opacity=".35" stroke="none"/><g fill="#211C16" stroke="#211C16">${f.e}${f.m}${f.x || ''}</g></svg>`;
  }

  /* —— 滑块档位工具 —— */
  function buildScale(q) { if (!q.segments) return null; const vals = [q.min]; let cur = q.min; q.segments.forEach(s => { while (cur < s.to) { cur = Math.round(cur + s.step); vals.push(cur); } }); return Array.from(new Set(vals)); }
  function nearestIdx(scale, t) { let b = 0, d = Infinity; scale.forEach((v, i) => { const dd = Math.abs(v - t); if (dd < d) { d = dd; b = i; } }); return b; }
  function getQuip(q, val) { const hit = q.quips.find(x => val <= x.upTo); return hit || { text: '', mood: 'chill' }; }

  /* ============================================================
     页面渲染
     ============================================================ */

  /* —— intro —— */
  function renderIntro() {
    screen(`
      <div class="rise d1"><h1 class="hero">几岁能<em>躺平</em>？<br>测测你的<br><em>理财人格</em></h1></div>
      <p class="subtitle rise d2">${TOTAL} 题<br>约 90 秒<br>算出你几岁退休 + 送你一个搞笑人格码。<br>搞钱搞不动，那就先笑一个。</p>
      <div class="rise d3" style="margin-top:auto;"><button class="btn coral" id="start">开测，看看我有多惨</button></div>
      <p class="tiny rise d4">本测试只为博你一乐，数字基于复利模型测算，仅供参考。</p>
    `);
    document.getElementById('start').onclick = () => {
      SFX.setOn(true); SFX.unlock(); SFX.play('start'); SFX.bgmStart();
      state.stage = 'q'; state.idx = 0; go();
    };
  }

  /* ============================================================
     弹幕引擎 —— 预制毒舌弹幕，答题时从右飘到左
     ============================================================ */
  const DANMAKU_POOL = [
    '上个月也是这么说的', '存钱？下个月一定', '这个选项是在暗示我穷吗',
    '笑死，根本不知道选哪个', '花呗：该来的总会来的', '余额：你礼貌吗',
    '我妈看到会说"你看吧"', '假装在认真思考', '选C！不选A！反正都是错的',
    '这题我做过——我是说上一轮', '有人已经测出了吃土圣体', '你的存款正在远程嘲笑你',
    '奶茶钱省一省，退休早一年', '别想了，你心里已经有答案了', '正在偷看别人的答案…',
    '有人选了跟你一样的选项并穷着', '理财第一步：打开这个测试', '当你看到这条弹幕时钱又少了',
    '填空题最难的是面对真实的自己', '加油，离退休又近了一道题', '搞钱搞不动，弹幕先飘一会儿',
    '基金绿了，弹幕也绿了（并没有）','有人边吃外卖边做这个测试', '这题我选D——D是哪个来着',
    '测完发朋友圈的都是勇士', '前面那个选A的等等我', '弹幕比题目有意思系列',
    '大数据告诉我你是个月光', '已有人分享结果并获得"你疯了吧"评论', '钱格测试，测完更焦虑（开玩笑的）',
  ];
  let danmakuTimer = null;
  function danmakuStart() {
    if (danmakuTimer) return;
    const spawn = () => {
      if (state.stage !== 'result') return; // 只在结果页飘
      const layer = document.getElementById('danmaku-layer'); // 每次重新查，防页面切换后引用失效
      if (!layer) return;
      const el = document.createElement('div');
      const cls = Math.random() < 0.2 ? 'accent' : (Math.random() < 0.15 ? 'gold' : '');
      el.className = 'danmaku ' + cls;
      el.textContent = DANMAKU_POOL[Math.floor(Math.random() * DANMAKU_POOL.length)];
      el.style.top = (8 + Math.random() * 82) + '%';
      el.style.animationDuration = (7 + Math.random() * 8) + 's';
      el.style.fontSize = (13 + Math.random() * 6) + 'px';
      layer.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    };
    setTimeout(() => spawn(), 500); // 首屏渲染后再触发，不用等第一个 interval
    danmakuTimer = setInterval(spawn, 1400 + Math.random() * 1600);
  }
  let danmakuOn = true;
  function danmakuStop() { if (danmakuTimer) { clearInterval(danmakuTimer); danmakuTimer = null; } danmakuLayer.innerHTML = ''; }
  function danmakuToggle() { danmakuOn = !danmakuOn; if (danmakuOn) danmakuStart(); else danmakuStop(); return danmakuOn; }

  /* —— 计算题（滑块，小人上方）—— */
  function renderCalc(item, i) {
    const q = item.q, val = state.calc[q.key];
    const fmt = (v) => (q.unit === '元' || q.unit === '元/月') ? Number(v).toLocaleString('zh-CN') : v;
    const scale = buildScale(q);
    const attrs = scale ? `min="0" max="${scale.length - 1}" step="1" value="${nearestIdx(scale, val)}"` : `min="${q.min}" max="${q.max}" step="${q.step}" value="${val}"`;
    const quip0 = getQuip(q, val);
    screen(`
      ${progressBar(i)}
      <div class="rise d2"><div class="q-index">第 ${i + 1} 题 / ${TOTAL}</div><div class="q-scene">${q.label}</div></div>
      <div class="rise d3">
        <div class="talker"><div class="face" id="face">${faceSVG(quip0.mood)}</div><div class="bubble" id="quip">${quip0.text}</div></div>
        <div class="slider-value"><span id="sv">${fmt(val)}</span><span class="u">${q.unit}</span></div>
        <input type="range" id="rng" ${attrs}>
      </div>
      <div class="navbar rise d4">
        ${i > 0 ? '<button class="btn ghost back" id="back">上一题</button>' : ''}
        <button class="btn coral" id="next">下一题</button>
      </div>
    `);
    const rng = document.getElementById('rng'), sv = document.getElementById('sv'), quip = document.getElementById('quip'), face = document.getElementById('face');
    let lastMood = quip0.mood;
    rng.oninput = () => {
      const v = scale ? scale[+rng.value] : +rng.value;
      state.calc[q.key] = v; sv.textContent = fmt(v);
      const nq = getQuip(q, v); quip.textContent = nq.text;
      quip.classList.remove('swap'); void quip.offsetWidth; quip.classList.add('swap');
      SFX.play('tick');
      if (nq.mood !== lastMood) {
        face.innerHTML = faceSVG(nq.mood); face.classList.remove('pop'); void face.offsetWidth; face.classList.add('pop');
        SFX.play(['smug', 'wow', 'money', 'wink', 'chill'].includes(nq.mood) ? 'moodUp' : 'moodDown');
        lastMood = nq.mood;
      }
    };
    document.getElementById('next').onclick = () => { SFX.play('tap'); state.idx = i + 1; go(); };
    if (i > 0) document.getElementById('back').onclick = () => { SFX.play('tap'); state.idx = i - 1; go(); };
  }

  /* —— 程度滑块题（5 档离散 + 实时回嘴）—— */
  function renderScale(item, i) {
    const q = item.q;
    const saved = state.answers[q.id];
    const startIdx = saved != null ? saved.stopIdx : 2;
    const s0 = q.stops[startIdx];
    screen(`
      ${progressBar(i)}
      <div class="rise d2"><div class="q-index">第 ${i + 1} 题 / ${TOTAL}</div><div class="q-scene">${q.scene}</div></div>
      <div class="rise d3">
        <div class="talker"><div class="face" id="face">${faceSVG(s0.m)}</div><div class="bubble" id="quip">${s0.t}</div></div>
        <input type="range" id="rng" min="0" max="${q.stops.length - 1}" step="1" value="${startIdx}">
        <div class="scale-ends"><span>${q.left}</span><span>${q.right}</span></div>
      </div>
      <div class="navbar rise d4">
        <button class="btn ghost back" id="back">上一题</button>
        <button class="btn coral" id="next">下一题</button>
      </div>
    `);
    const rng = document.getElementById('rng'), quip = document.getElementById('quip'), face = document.getElementById('face');
    let lastMood = s0.m;
    state.answers[q.id] = { stopIdx: startIdx, feed: q.stops[startIdx].feed };
    rng.oninput = () => {
      const k = +rng.value; const s = q.stops[k];
      state.answers[q.id] = { stopIdx: k, feed: s.feed };
      quip.textContent = s.t; quip.classList.remove('swap'); void quip.offsetWidth; quip.classList.add('swap');
      SFX.play('tick');
      if (s.m !== lastMood) {
        face.innerHTML = faceSVG(s.m); face.classList.remove('pop'); void face.offsetWidth; face.classList.add('pop');
        SFX.play(['smug', 'wow', 'money', 'wink', 'chill'].includes(s.m) ? 'moodUp' : 'moodDown');
        lastMood = s.m;
      }
    };
    document.getElementById('next').onclick = () => { SFX.play('tap'); state.idx = i + 1; go(); };
    document.getElementById('back').onclick = () => { SFX.play('tap'); state.idx = i - 1; go(); };
  }

  /* —— 选择题（ABCD + 小人回嘴 + 手动下一题）—— */
  const ROAST = {
    'E':'早起的鸟儿有虫吃，但你五点就起了……', 'L':'不着急，退休是别人的事，你先忙着',
    'R':'每省一块钱，就有一只余额在偷偷感谢你', 'C':'花！花钱的快乐，存钱的人这辈子不懂',
    'M':'有底的人说话就是硬气，余额给的底气', 'B':'白手起家，未来可期——指遥远的未来',
    'H':'胃口不小，梦想很大，钱包：我压力好大', 'S':'知足常乐，佛系选手，欲望低到尘埃里',
  };
  function renderChoice(item, i) {
    const q = item.q;
    const saved = state.answers[q.id];
    const tags = ['A', 'B', 'C', 'D', 'E', 'F'];
    screen(`
      ${progressBar(i)}
      <div class="rise d2"><div class="q-index">${item.isCity ? '最后一题' : `第 ${i + 1} 题 / ${TOTAL}`}</div><div class="q-scene">${q.scene}</div></div>
      <div class="talker rise d3" id="talker"><div class="face" id="face">${faceSVG('chill')}</div><div class="bubble" id="roastBubble">选一个呗，别紧张，反正都不会让你暴富 😏</div></div>
      <div class="rise d3" id="opts"></div>
      <div class="navbar rise d4">
        <button class="btn ghost back" id="back">上一题</button>
        <button class="btn coral" id="next" ${saved == null ? 'disabled' : ''}>${item.isCity ? '看结果' : '下一题'}</button>
      </div>
    `);
    const opts = document.getElementById('opts');
    const talker = document.getElementById('talker');
    const face = document.getElementById('face');
    const bubble = document.getElementById('roastBubble');
    // 回退时恢复已选状态 + 回嘴
    if (saved) {
      setTimeout(() => {
        const feed = saved.feed || '';
        const dim = feed.replace('egg:','').charAt(0).toUpperCase();
        bubble.textContent = ROAST[dim] || '好的，记住你的选择了 👀';
        face.innerHTML = faceSVG(['smug','wink','chill'][Math.floor(Math.random()*3)]);
        talker.style.opacity = '1';
      }, 100);
    }
    q.options.forEach((opt, k) => {
      const b = document.createElement('button');
      b.className = 'option' + (saved && saved.k === k ? ' chosen' : '');
      b.innerHTML = `<span class="tag">${tags[k]}</span><span>${opt.text}</span>`;
      b.onclick = () => {
        state.answers[q.id] = { k, feed: opt.feed };
        opts.querySelectorAll('.option').forEach(o => o.classList.remove('chosen'));
        b.classList.add('chosen');
        document.getElementById('next').disabled = false;
        SFX.play('select');
        // 小人回嘴
        const feed = opt.feed || '';
        const dim = feed.replace('egg:','').charAt(0).toUpperCase();
        bubble.textContent = ROAST[dim] || '好的，记住你的选择了 👀';
        face.innerHTML = faceSVG(['smug','wink','chill'][Math.floor(Math.random()*3)]);
      };
      opts.appendChild(b);
    });
    document.getElementById('next').onclick = () => {
      if (state.answers[q.id] == null) return;
      SFX.play('tap'); state.idx = i + 1; go();
    };
    document.getElementById('back').onclick = () => { SFX.play('tap'); state.idx = i - 1; go(); };
  }

  /* —— 加载 —— */
  const LOAD = ['正在分析你的财务DNA…', '正在偷看你的钱包…', '正在计算你离躺平还有多远…'];
  function renderLoading() {
    screen(`<div class="loading"><div class="spinner"></div><div class="dna" id="dna">${LOAD[0]}</div><div class="hint">（此处未来可放一个广告位）</div></div>`);
    let n = 0; const el = document.getElementById('dna');
    const t = setInterval(() => { n = (n + 1) % LOAD.length; if (el) el.textContent = LOAD[n]; }, 700);
    setTimeout(() => {
      clearInterval(t);
      state.result = window.QGEngine.analyze(state.calc);
      state.stage = 'result';
      SFX.play('fanfare');
      go();
    }, 2000);
  }

  /* —— 雷达图 —— */
  function radarSVG(s) {
    const labels = [{ k: 'start', n: '起步' }, { k: 'save', n: '储蓄' }, { k: 'principal', n: '本金' }, { k: 'desire', n: '物欲' }];
    const cx = 110, cy = 110, R = 78;
    const pt = (idx, r) => { const a = -Math.PI / 2 + idx * 2 * Math.PI / 4; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
    let grid = ''; [0.33, 0.66, 1].forEach(g => { const p = labels.map((_, idx) => pt(idx, R * g).join(',')).join(' '); grid += `<polygon points="${p}" fill="none" stroke="#211C16" stroke-opacity=".18" stroke-width="1.5"/>`; });
    const poly = labels.map((l, idx) => pt(idx, R * s[l.k]).join(',')).join(' ');
    let axes = '', text = ''; labels.forEach((l, idx) => { const [x, y] = pt(idx, R); axes += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#211C16" stroke-opacity=".18" stroke-width="1.5"/>`; const [lx, ly] = pt(idx, R + 18); text += `<text x="${lx}" y="${ly}" font-size="13" fill="#211C16" text-anchor="middle" dominant-baseline="middle" font-family="var(--display)">${l.n}</text>`; });
    return `<svg width="220" height="220" viewBox="0 0 220 220" xmlns="http://www.w3.org/2000/svg">${grid}${axes}<polygon points="${poly}" fill="#FF4D2E" fill-opacity=".35" stroke="#FF4D2E" stroke-width="2.5"/>${text}</svg>`;
  }

  const TYPE_EMOJI = { ERMH: '🔨', ERMS: '😴', ERBH: '💪', ERBS: '🧘', ECMH: '🔥', ECMS: '💸', ECBH: '🎰', ECBS: '👑', LRMH: '🏃', LRMS: '🎣', LRBH: '🐹', LRBS: '🌵', LCMH: '🎫', LCMS: '🛍️', LCBH: '📝', LCBS: '🍜' };
  function fallbackPersona(code) { return { title: code + ' 型', subtitle: '文案待填', quote: '（金句待填）', reading: '解读待填。', blindspot: '盲点待填。', twist: '反转待填。', match: { code: '----', line: '最佳搭档待填' }, hook: '想躺得更安心一点？哪天有空，来鑫芽随便逛逛就好。' }; }

  // 维度 → 人话/能量条标签
  const DIM_LABEL = {
    E:'起步早', L:'起步晚', R:'能存', C:'月光', M:'有底', B:'白手', H:'物欲高', S:'物欲低'
  };
  const BAR_WORD = {
    E:'早鸟', L:'临门一脚', R:'铁公鸡', C:'月光', M:'有矿', B:'白手', H:'很想要', S:'佛系'
  };

  /* —— 结果页 v3（有高低起伏的过关结算）—— */
  function renderResult() {
    const r = state.result; const code = r.dimensions.code;
    const dims = r.dimensions.dims; // {start, save, principal, desire}
    const p = PERSONALITIES[code] || fallbackPersona(code);
    const partner = PERSONALITIES[p.match.code] || fallbackPersona(p.match.code);
    const cityFeed = state.answers['city'] && state.answers['city'].feed;
    const cityName = cityFeed ? cityFeed.replace('city:', '') : '你的城市';
    const ageTxt = (a) => isFinite(a) ? Math.round(a) + '<span class="u">岁</span>' : '再想想';

    // 人话维度行 + 能量条
    const dimRow = ['start','save','principal','desire'].map(k => DIM_LABEL[dims[k]]).join(' · ');
    const diffYears = (isFinite(r.r2) && isFinite(r.r10)) ? Math.abs(Math.round(r.r2 - r.r10)) : null;
    const gapMsg = diffYears ? `↑ 只存银行要 ${Math.round(r.r2)} 岁，差了整整 ${diffYears} 年` : '';

    screen(`
      <div class="hero-rank rise d1">
        <div class="code-badge">${code.split('').join('')}</div>
        <div class="hero-code">${dimRow}</div>
        <div class="hero-title">${p.title}</div>
        ${p.subtitle ? `<div class="hero-sub">${p.subtitle}</div>` : ''}
      </div>

      <div class="quote rise d2">${p.quote}</div>

      <div class="rank rise d2">在<b>${cityName}</b>，你的退休速度打败了 <b id="rankPct">0%</b> 的人 🏙️</div>

      <div class="compare rise d3">
        <div class="compare-tabs">
          <button class="compare-tab active" data-m="bank">只存银行</button>
          <button class="compare-tab" data-m="invest">合理理财</button>
        </div>
        <div class="compare-body" id="cmpBody">
          <div class="big" id="cmpBig">${ageTxt(r.r2)}</div>
          <div class="cap" id="cmpCap">按只存银行（假设年化2%），照这个存法大约能躺平的年纪</div>
        </div>
      </div>
      ${gapMsg ? `<div class="gap-hint rise d3">${gapMsg}</div>` : ''}
      <p class="compare-note rise d3">假设年化收益率，非任何投资建议或收益承诺。</p>

      <div class="bars rise d4">
        <div class="bar-row"><span class="bk">起步</span><span class="track"><i style="width:${(r.dimensions.scores.start*100).toFixed(0)}%"></i></span><span class="bv">${BAR_WORD[dims.start]}</span></div>
        <div class="bar-row"><span class="bk">储蓄</span><span class="track"><i style="width:${(r.dimensions.scores.save*100).toFixed(0)}%"></i></span><span class="bv">${BAR_WORD[dims.save]}</span></div>
        <div class="bar-row"><span class="bk">本金</span><span class="track"><i style="width:${(r.dimensions.scores.principal*100).toFixed(0)}%"></i></span><span class="bv">${BAR_WORD[dims.principal]}</span></div>
        <div class="bar-row"><span class="bk">物欲</span><span class="track"><i style="width:${(r.dimensions.scores.desire*100).toFixed(0)}%"></i></span><span class="bv">${BAR_WORD[dims.desire]}</span></div>
      </div>

      <div class="insight reading rise d4"><div class="h">🔍 人格剖析</div><p>${p.reading}</p></div>
      <div class="insight blind rise d5"><div class="h">⚡ 你的盲点</div><p>${p.blindspot}</p></div>
      <div class="insight twist rise d5"><div class="h">🌤 但是吧……</div><p>${p.twist}</p></div>

      <div class="match rise d5">
        <div class="match-h">🤝 你的最佳财格搭档</div>
        <div class="match-name">${partner.title} <span class="match-code">${p.match.code}</span></div>
        <p>${p.match.line}</p>
      </div>

      <div class="hook rise d6">${p.hook}</div>
      <div class="act rise d6" id="footActions"></div>
      <p class="tiny">数字基于复利模型和你的关键数据测算，仅供娱乐参考。</p>
      <canvas id="cardCanvas" width="900" height="1260" style="display:none"></canvas>
    `);

    // 弹幕：结果页启动 + 顶部开关
    danmakuStart();
    const sndBar = document.querySelector('.topbar');
    if (sndBar) {
      const dmBtn = document.createElement('button');
      dmBtn.className = 'sound-toggle on';
      dmBtn.id = 'dmBtn'; dmBtn.textContent = '💬'; dmBtn.style.marginLeft = '6px';
      dmBtn.onclick = () => { const on = danmakuToggle(); dmBtn.textContent = on ? '💬' : '🚫'; dmBtn.classList.toggle('on', on); };
      sndBar.appendChild(dmBtn);
    }

    // 收益率切换
    const tabs = root.querySelectorAll('.compare-tab');
    const big = document.getElementById('cmpBig'), cap = document.getElementById('cmpCap'), body = document.getElementById('cmpBody');
    tabs.forEach(tab => tab.onclick = () => {
      SFX.play('flip');
      tabs.forEach(t => t.classList.remove('active')); tab.classList.add('active');
      if (tab.dataset.m === 'bank') { big.innerHTML = ageTxt(r.r2); cap.textContent = '按只存银行（假设年化2%），照这个存法大约能躺平的年纪'; }
      else { big.innerHTML = ageTxt(r.r10); cap.textContent = '按合理理财（假设年化10%），照这个存法大约能躺平的年纪'; }
      body.classList.remove('flip'); void body.offsetWidth; body.classList.add('flip');
    });

    // 排名数字跳动
    const rankEl = document.getElementById('rankPct');
    if (rankEl) {
      const target = r.cityPercentile; let cur = 0;
      const step = Math.max(1, Math.round(target / 24));
      const ti = setInterval(() => { cur += step; if (cur >= target) { cur = target; clearInterval(ti); } rankEl.textContent = cur + '%'; SFX.play('countTick'); }, 36);
    }

    // 底部按钮
    const fa = document.getElementById('footActions');
    if (state.shared) {
      fa.innerHTML = `<button class="btn coral" id="goTest">测测我是哪种 →</button>`;
      document.getElementById('goTest').onclick = () => { location.href = location.pathname; };
    } else {
      fa.innerHTML = `<button class="btn coral" id="save">保存我的结果图，去晒 📸</button>
        <button class="btn" id="shareBtn">复制分享链接</button>
        <button class="btn ghost" id="restart">重测一次</button>`;
      document.getElementById('restart').onclick = () => { SFX.play('tap'); danmakuStop(); state.stage = 'intro'; state.idx = 0; state.answers = {}; CALC_QUESTIONS.forEach(q => state.calc[q.key] = q.default); go(); };
      document.getElementById('save').onclick = () => { SFX.play('press'); buildShareCard(r, p); };
      document.getElementById('shareBtn').onclick = () => {
        const link = location.origin + location.pathname + '?r=' + encodeResult(r);
        navigator.clipboard.writeText(link).then(() => { const b = document.getElementById('shareBtn'); b.textContent = '已复制！发给朋友吧'; setTimeout(() => { b.textContent = '复制分享链接'; }, 2000); }).catch(() => { prompt('复制这个链接发给朋友：', link); });
      };
    }
  }

  /* ============================================================
     分享图 v3 · 方向B 收藏卡（两遍绘制，自动裁高）
     ============================================================ */
  const SC = { W: 900, M: 36 };
  async function drawShareCard(ctx, res, p) {
    const W = SC.W, M = SC.M;
    const H = ctx.canvas.height;
      if (document.fonts && document.fonts.ready) {
        try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 800))]); } catch (_) { }
      }
      const F = (size, weight = '700') => `${weight} ${size}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif`;
      const cityFeed2 = state.answers['city'] && state.answers['city'].feed;
      const cityName2 = cityFeed2 ? cityFeed2.replace('city:', '') : '你的城市';
      const codeLetters = res.dimensions.code.split('').join(' ');
      const r10age = isFinite(res.r10) ? Math.round(res.r10) + '岁' : '∞';
      const r2age = isFinite(res.r2) ? Math.round(res.r2) + '岁' : '∞';

    // 底：暖纸 + 圆点纹理
    ctx.fillStyle = '#F2E9D8'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(234,223,201,.5)';
    for (let px = 0; px < W; px += 18) for (let py = 0; py < H; py += 18) { ctx.beginPath(); ctx.arc(px, py, .8, 0, Math.PI*2); ctx.fill(); }

    // 卡牌框 + 硬投影
    ctx.fillStyle = '#211C16';
    roundRect(ctx, M+5, M+5, W-M*2, H-M*2, 14); ctx.fill();
    ctx.fillStyle = '#FBF6EA';
    roundRect(ctx, M, M, W-M*2, H-M*2, 14); ctx.fill();
    ctx.strokeStyle = '#211C16'; ctx.lineWidth = 3;
    roundRect(ctx, M, M, W-M*2, H-M*2, 14); ctx.stroke();

    ctx.textAlign = 'center'; let y = M+10;

    // 卡头
    ctx.fillStyle = '#211C16'; roundRect(ctx, M+4, y, W-M*2-8, 54, 10); ctx.fill();
    ctx.font = F(15,'700'); ctx.fillStyle = '#E8A33D';
    ctx.textAlign = 'left'; ctx.fillText(codeLetters, M+22, y+35);
    // 稀有度标
    ctx.textAlign = 'right'; ctx.font = F(12,'700'); ctx.fillStyle = '#FF4D2E';
    ctx.strokeStyle = '#FF4D2E'; ctx.lineWidth = 1.5;
    roundRect(ctx, W-M-140, y+10, 116, 34, 6); ctx.stroke();
    ctx.fillText(`击败${cityName2} ${res.cityPercentile}%`, W-M-30, y+32);
    ctx.textAlign = 'center'; y += 74;

    // 称号区
    ctx.fillStyle = '#FF4D2E'; roundRect(ctx, M+4, y, W-M*2-8, 96, 12); ctx.fill();
    ctx.font = F(46,'900'); ctx.fillStyle = '#fff';
    smartWrap(ctx, p.title, W/2, y+55, W-140, 52);
    if (p.subtitle) { ctx.font = F(16,'400'); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(p.subtitle, W/2, y+82); }
    y += 116;

    // 数据行 ×2
    ctx.fillStyle = '#FBF6EA'; ctx.strokeStyle = '#211C16'; ctx.lineWidth = 2;
    roundRect(ctx, M+10, y, W-M*2-20, 52, 10); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left'; ctx.font = F(14,'400'); ctx.fillStyle = '#5A5247'; ctx.fillText('合理理财 · 能躺平年纪', M+28, y+32);
    ctx.textAlign = 'right'; ctx.font = F(30,'900'); ctx.fillStyle = '#FF4D2E'; ctx.fillText(r10age, W-M-28, y+32);
    y += 66;
    ctx.textAlign = 'left'; ctx.fillStyle = '#FBF6EA';
    roundRect(ctx, M+10, y, W-M*2-20, 52, 10); ctx.fill(); ctx.stroke();
    ctx.font = F(14,'400'); ctx.fillStyle = '#5A5247'; ctx.fillText('只存银行 · 要熬到', M+28, y+32);
    ctx.textAlign = 'right'; ctx.font = F(30,'900'); ctx.fillStyle = '#211C16'; ctx.fillText(r2age, W-M-28, y+32);
    ctx.textAlign = 'center'; y += 80;

    // 金句卡
    ctx.fillStyle = '#211C16'; roundRect(ctx, M+10, y, W-M*2-20, 62, 10); ctx.fill();
    ctx.font = F(13,'400'); ctx.fillStyle = '#F2E9D8';
    smartWrap(ctx, '"'+p.quote+'"', W/2, y+32, W-140, 22);
    y += 80;

    // QR + 卡脚
    const shareURL = location.origin + location.pathname + '?r=' + encodeResult(res);
    const qrURL = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(shareURL);
    try {
      const qrImg = await new Promise((resolve, reject) => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img); img.onerror = () => reject(new Error('QR load fail'));
        img.src = qrURL;
      });
      ctx.drawImage(qrImg, M+22, y, 120, 120);
    } catch (_) {}
    ctx.textAlign = 'left';
    ctx.font = F(13,'700'); ctx.fillStyle = '#FF4D2E'; ctx.fillText('钱格测试', M+160, y+40);
    ctx.font = F(11,'400'); ctx.fillStyle = '#5A5247'; ctx.fillText('长按扫码，测你是哪种', M+160, y+62);
    ctx.fillText('快乐的穷鬼', M+160, y+80);
    return y;
  }

  async function buildShareCard(res, p) {
    try {
      const c = document.getElementById('cardCanvas');
      if (document.fonts && document.fonts.ready) {
        try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 800))]); } catch (_) { }
      }
      // 第一遍：临时高度跑一次，拿到真实底部 y
      c.width = SC.W; c.height = 1400;
      const finalY = await drawShareCard(c.getContext('2d'), res, p);
      // 第二遍：裁到真实高度重画
      c.height = Math.round(finalY + 156);
      await drawShareCard(c.getContext('2d'), res, p);
      showSavableImage(c.toDataURL('image/png'));
    } catch (e) { alert('生成图片失败，请重试一次：' + e.message); }
  }
  function showSavableImage(dataURL) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;overflow:auto;';
    ov.innerHTML = `<p style="color:#fff;font-size:15px;margin:0 0 12px;text-align:center;">长按图片保存到相册 👇</p><img src="${dataURL}" style="max-width:100%;max-height:78vh;border-radius:12px;"><button style="margin-top:16px;padding:10px 22px;border:0;border-radius:24px;font-size:15px;">关闭</button>`;
    ov.querySelector('button').onclick = () => ov.remove();
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    document.body.appendChild(ov);
  }
  // 智能换行：先量整句，一行能放下就一行；放不下尽量均匀断两行，不出现第二行孤字
  function smartWrap(ctx, text, x, y, maxW, lh) {
    const w = ctx.measureText(text).width;
    if (w <= maxW) { ctx.fillText(text, x, y); return; }
    // 找接近中点、优先标点处断
    const mid = Math.floor(text.length / 2);
    let brk = mid;
    const punct = ',，.。!！?？;；:：、—… ';
    for (let i = mid; i < text.length && i < mid + 6; i++) { if (punct.includes(text[i])) { brk = i + 1; break; } }
    if (brk === mid) { for (let i = mid; i > mid - 6 && i > 2; i--) { if (punct.includes(text[i])) { brk = i + 1; break; } } }
    const l1 = text.slice(0, brk), l2 = text.slice(brk);
    ctx.fillText(l1, x, y);
    ctx.fillText(l2, x, y + lh);
  }
  function wrapText(ctx, text, x, y, maxW, lh) { const chars = text.split(''); let line = '', yy = y; for (const ch of chars) { if (ctx.measureText(line + ch).width > maxW && line) { ctx.fillText(line, x, yy); line = ch; yy += lh; } else line += ch; } ctx.fillText(line, x, yy); }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  /* ============================================================
     路由 + 转场
     ============================================================ */
  function go() {
    transition(() => {
      if (state.stage === 'intro') return renderIntro();
      if (state.stage === 'result') return renderResult();
      if (state.idx >= FLOW.length) { state.stage = 'loading'; return renderLoading(); }
      const item = FLOW[state.idx];
      if (item.kind === 'calc') return renderCalc(item, state.idx);
      if (item.kind === 'scale') return renderScale(item, state.idx);
      if (item.kind === 'choice') return renderChoice(item, state.idx);
    });
  }

  // 启动：读分享链接
  const sp = new URLSearchParams(location.search);
  if (sp.has('r')) {
    try { state.result = decodeResult(sp.get('r')); state.shared = true; state.stage = 'result'; } catch (e) { /* 坏链接进首页 */ }
  }
  go();
})();
