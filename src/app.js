/* ============================================================
 * app.js — 钱格测试 交互框架（状态机 + 渲染 + 雷达 + 结果图）
 * 由框架作者写好。DeepSeek 一般不用动这里，只填 content.js。
 * 流程：intro → 计算题(滑块) → 性格题(选项) → 加载 → 结果
 * ============================================================ */
(function () {
  const { CALC_QUESTIONS, PERSONALITY_QUESTIONS, PERSONALITIES } = window.QGContent;
  const root = document.getElementById('app');

  const state = {
    stage: 'intro',
    shared: false,   // 从分享链接点进来 → true，直接展示结果
    calc: {},        // {currentAge: 28, ...}
    pIndex: 0,       // 当前性格题下标
    pAnswers: [],    // [{id, feed}]
    result: null,
  };

  /* ---------- 分享链接编解码（UTF-8 安全，无废弃 API）---------- */
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

  // 预填计算题默认值
  CALC_QUESTIONS.forEach((q) => (state.calc[q.key] = q.default));

  /* ---------- 顶部 logo ---------- */
  function brand() {
    return `<div class="brand"><span class="dollar">$</span>BTI&nbsp;<span class="brand-name">钱格测试</span></div>`;
  }

  /* ---------- intro ---------- */
  function renderIntro() {
    root.innerHTML = `
      ${brand()}
      <div class="reveal d1">
        <h1 class="title">几岁能<em>躺平</em>？<br>测测你的<br><em>理财人格</em></h1>
        <p class="subtitle">25 道题 · 90 秒 · 算出你几岁退休 + 送你一个搞笑人格码。<br>搞钱搞不动，那就先笑一个。</p>
      </div>
      <div class="reveal d2"><button class="btn coral" id="start">开测，看看我有多惨</button></div>
      <p class="tiny reveal d3">本测试只为博你一乐，数字基于复利模型测算，仅供参考。</p>
    `;
    document.getElementById('start').onclick = () => { state.stage = 'calc'; state.calcIndex = 0; render(); };
  }

  // 全测题目总数（计算题 + 性格题），用于统一编号和进度
  const TOTAL = CALC_QUESTIONS.length + PERSONALITY_QUESTIONS.length;

  // 根据当前值取吐槽对象：第一个 upTo >= val 的那条 {text, mood}
  function getQuip(q, val) {
    if (!q.quips) return { text: '', mood: 'chill' };
    const hit = q.quips.find((x) => val <= x.upTo);
    return hit || { text: '', mood: 'chill' };
  }

  /* ---------- 贱兮兮的表情脸（SVG，跟着 mood 变）---------- */
  function faceSVG(mood) {
    // 每种 mood 定义一对眼睛 + 嘴 + 可选配件
    const F = {
      chill:  { eyes: '<circle cx="36" cy="46" r="4"/><circle cx="64" cy="46" r="4"/>', mouth: '<path d="M38 64 Q50 70 62 64" fill="none" stroke-width="4" stroke-linecap="round"/>' },
      smug:   { eyes: '<path d="M30 46 q6 -5 12 0" /><path d="M58 46 q6 -5 12 0"/>', mouth: '<path d="M36 62 Q52 74 64 60" fill="none" stroke-width="4" stroke-linecap="round"/>', extra: '' },
      sneer:  { eyes: '<path d="M30 44 q6 4 12 0"/><circle cx="64" cy="46" r="4"/>', mouth: '<path d="M38 66 q6 -8 12 0 q6 8 12 0" fill="none" stroke-width="4" stroke-linecap="round"/>' },
      sour:   { eyes: '<circle cx="38" cy="44" r="4"/><circle cx="66" cy="44" r="4"/>', mouth: '<path d="M38 66 L62 66" stroke-width="4" stroke-linecap="round"/>', extra: '<path d="M74 40 q6 8 0 14" fill="none" stroke-width="3" opacity="0.6"/>' },
      cry:    { eyes: '<circle cx="36" cy="46" r="6"/><circle cx="64" cy="46" r="6"/>', mouth: '<path d="M40 68 Q50 60 60 68" fill="none" stroke-width="4" stroke-linecap="round"/>', extra: '<path d="M34 52 q-2 8 0 12" fill="none" stroke-width="3" opacity="0.7"/><path d="M66 52 q2 8 0 12" fill="none" stroke-width="3" opacity="0.7"/>' },
      wow:    { eyes: '<circle cx="36" cy="45" r="7"/><circle cx="64" cy="45" r="7"/>', mouth: '<ellipse cx="50" cy="66" rx="8" ry="10" fill="none" stroke-width="4"/>' },
      roll:   { eyes: '<path d="M30 48 a6 6 0 0 1 12 0" fill="none" stroke-width="4"/><path d="M58 48 a6 6 0 0 1 12 0" fill="none" stroke-width="4"/>', mouth: '<path d="M38 66 L62 66" stroke-width="4" stroke-linecap="round"/>' },
      wink:   { eyes: '<path d="M30 46 q6 4 12 0" fill="none" stroke-width="4"/><circle cx="64" cy="46" r="4"/>', mouth: '<path d="M36 60 Q52 74 66 60" fill="none" stroke-width="4" stroke-linecap="round"/>' },
      dead:   { eyes: '<path d="M32 46 L42 46"/><path d="M58 46 L68 46"/>', mouth: '<path d="M38 66 L62 66" stroke-width="4" stroke-linecap="round"/>' },
      money:  { eyes: '<text x="36" y="52" font-size="16" text-anchor="middle" stroke="none">$</text><text x="64" y="52" font-size="16" text-anchor="middle" stroke="none">$</text>', mouth: '<path d="M34 60 Q50 76 66 60 Q50 66 34 60" stroke-width="3"/>' },
    };
    const f = F[mood] || F.chill;
    return `<svg viewBox="0 0 100 100" class="face-svg" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="40" fill="#FFD27D" stroke="#211C16" stroke-width="4"/>
      <circle cx="30" cy="60" r="6" fill="#FF4D2E" opacity="0.35" stroke="none"/>
      <circle cx="70" cy="60" r="6" fill="#FF4D2E" opacity="0.35" stroke="none"/>
      <g fill="#211C16" stroke="#211C16">${f.eyes}${f.mouth}${f.extra || ''}</g>
    </svg>`;
  }

  // 由分段定义生成"档位数组"（前密后疏）。滑块走索引，落点永远是合理整数档。
  function buildScale(q) {
    const vals = [q.min];
    let cur = q.min;
    q.segments.forEach((seg) => {
      while (cur < seg.to) {
        cur = Math.round(cur + seg.step);
        vals.push(cur);
      }
    });
    return Array.from(new Set(vals)); // 去重
  }

  // 找最接近 target 的档位索引
  function nearestIndex(scale, target) {
    let best = 0, diff = Infinity;
    scale.forEach((v, idx) => {
      const d = Math.abs(v - target);
      if (d < diff) { diff = d; best = idx; }
    });
    return best;
  }

  /* ---------- 计算题（滑块，逐题）---------- */
  function renderCalc() {
    const i = state.calcIndex || 0;
    const q = CALC_QUESTIONS[i];
    const val = state.calc[q.key];
    const fmt = (v) => (q.key === 'currentSavings' || q.unit === '元' ? Number(v).toLocaleString('zh-CN') : v);

    // 两种滑块：分段档位(segments) vs 线性(min/max/step)
    const scale = q.segments ? buildScale(q) : null;
    const sliderAttrs = scale
      ? `min="0" max="${scale.length - 1}" step="1" value="${nearestIndex(scale, val)}"`
      : `min="${q.min}" max="${q.max}" step="${q.step}" value="${val}"`;

    const quip0 = getQuip(q, val);

    root.innerHTML = `
      ${brand()}
      <div class="progress"><i style="width:${(i / TOTAL * 100).toFixed(0)}%"></i></div>
      <div class="card reveal d1">
        <div class="q-index">第 ${i + 1} 题 / ${TOTAL}</div>
        <div class="q-scene">${q.label}</div>
        <div class="slider-value"><span id="sv">${fmt(val)}</span><span class="u">${q.unit}</span></div>
        <input type="range" id="rng" ${sliderAttrs}>
        <div class="talker">
          <div class="face" id="face">${faceSVG(quip0.mood)}</div>
          <div class="bubble" id="quip">${quip0.text}</div>
        </div>
        <button class="btn coral" id="next">下一题</button>
      </div>
    `;
    const rng = document.getElementById('rng');
    const sv = document.getElementById('sv');
    const quip = document.getElementById('quip');
    const face = document.getElementById('face');
    let lastMood = quip0.mood;
    rng.oninput = () => {
      const v = scale ? scale[Number(rng.value)] : Number(rng.value);
      state.calc[q.key] = v;
      sv.textContent = fmt(v);
      const nq = getQuip(q, v);
      quip.textContent = nq.text;
      if (nq.mood !== lastMood) {           // 表情变了才重画 + 抖一下
        face.innerHTML = faceSVG(nq.mood);
        face.classList.remove('pop'); void face.offsetWidth; face.classList.add('pop');
        lastMood = nq.mood;
      }
    };
    document.getElementById('next').onclick = () => {
      if (i < CALC_QUESTIONS.length - 1) { state.calcIndex = i + 1; }
      else { state.stage = 'personality'; state.pIndex = 0; }
      render();
    };
  }

  /* ---------- 性格题（选项，逐题）---------- */
  function renderPersonality() {
    const i = state.pIndex;
    const list = PERSONALITY_QUESTIONS;
    if (i >= list.length) { state.stage = 'loading'; return render(); }
    const q = list[i];
    const done = CALC_QUESTIONS.length + i;
    const num = CALC_QUESTIONS.length + i + 1; // 接着计算题继续编号

    root.innerHTML = `
      ${brand()}
      <div class="progress"><i style="width:${(done / TOTAL * 100).toFixed(0)}%"></i></div>
      <div class="reveal d1">
        <div class="q-index">${q.type === 'city' ? '最后一题' : `第 ${num} 题 / ${TOTAL}`}</div>
        <div class="q-scene">${q.scene}</div>
      </div>
      <div id="opts"></div>
    `;
    const opts = document.getElementById('opts');
    q.options.forEach((opt, k) => {
      const b = document.createElement('button');
      b.className = 'option reveal d' + Math.min(5, k + 2);
      b.textContent = opt.text;
      b.onclick = () => {
        state.pAnswers.push({ id: q.id, feed: opt.feed });
        state.pIndex = i + 1;
        render();
      };
      opts.appendChild(b);
    });
  }

  /* ---------- 加载页（仪式感 + 未来广告位）---------- */
  const LOADING_LINES = ['正在分析你的财务DNA…', '正在偷看你的钱包…', '正在计算你离躺平还有多远…'];
  function renderLoading() {
    let n = 0;
    root.innerHTML = `
      ${brand()}
      <div class="loading">
        <div class="spinner"></div>
        <div class="dna" id="dna">${LOADING_LINES[0]}</div>
        <div class="hint">（此处未来可放一个广告位）</div>
      </div>`;
    const el = document.getElementById('dna');
    const t = setInterval(() => { n = (n + 1) % LOADING_LINES.length; if (el) el.textContent = LOADING_LINES[n]; }, 750);
    setTimeout(() => {
      clearInterval(t);
      state.result = window.QGEngine.analyze(state.calc);
      state.stage = 'result';
      render();
    }, 2200);
  }

  /* ---------- 雷达图（手绘 SVG，四维）---------- */
  function radarSVG(scores) {
    const labels = [
      { k: 'start', name: '时间本钱' },
      { k: 'save', name: '管手能力' },
      { k: 'principal', name: '起跑线' },
      { k: 'desire', name: '胃口大小' },
    ];
    const cx = 140, cy = 140, R = 100;
    const pt = (idx, r) => {
      const ang = -Math.PI / 2 + (idx * 2 * Math.PI) / 4;
      return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
    };
    let grid = '';
    [0.33, 0.66, 1].forEach((g) => {
      const p = labels.map((_, idx) => pt(idx, R * g).join(',')).join(' ');
      grid += `<polygon points="${p}" fill="none" stroke="#211C16" stroke-opacity="0.18" stroke-width="1.5"/>`;
    });
    const poly = labels.map((l, idx) => pt(idx, R * scores[l.k]).join(',')).join(' ');
    let axes = '', text = '';
    labels.forEach((l, idx) => {
      const [x, y] = pt(idx, R);
      axes += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#211C16" stroke-opacity="0.18" stroke-width="1.5"/>`;
      const [lx, ly] = pt(idx, R + 22);
      text += `<text x="${lx}" y="${ly}" font-size="13" fill="#211C16" text-anchor="middle" dominant-baseline="middle" font-family="var(--display)">${l.name}</text>`;
    });
    return `<svg width="280" height="280" viewBox="0 0 280 280" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto;">
      ${grid}${axes}
      <polygon points="${poly}" fill="#FF4D2E" fill-opacity="0.35" stroke="#FF4D2E" stroke-width="2.5"/>
      ${text}
    </svg>`;
  }

  /* ---------- 人格 emoji（16 型各配一个）---------- */
  const TYPE_EMOJI = {
    ERMH:'🔨', ERMS:'😴', ERBH:'💪', ERBS:'🧘',
    ECMH:'🔥', ECMS:'💸', ECBH:'🎰', ECBS:'👑',
    LRMH:'🏃', LRMS:'🎣', LRBH:'🐹', LRBS:'🌵',
    LCMH:'🎫', LCMS:'🛍️', LCBH:'📝', LCBS:'🍜',
  };

  /* ---------- 数字话术（举重若轻，不施压）---------- */
  function numbersBlock(res) {
    const r = res.retirement;
    const ageTxt = isFinite(r.achievableRetireAge)
      ? `${Math.round(r.achievableRetireAge)}<span class="u" style="font-size:14px">岁</span>`
      : `再想想<span class="u" style="font-size:14px"></span>`;
    const saveTxt = isFinite(r.monthlySaveNeeded)
      ? `${r.monthlySaveNeeded.toLocaleString('zh-CN')}`
      : '随缘';
    return `
      <div class="numbers">
        <div class="num-box"><div class="n">${ageTxt}</div><div class="l">照这个存法<br>大约能躺平喝咖啡☕</div></div>
        <div class="num-box"><div class="n">${saveTxt}</div><div class="l">想按时退休<br>每月该存(元)</div></div>
      </div>`;
  }

  /* ---------- 结果页 ---------- */
  function fallbackPersona(code) {
    return {
      title: `${code} 型（文案待填）`,
      quote: '（金句待 DeepSeek 填）',
      reading: `这一型（${code}）的解读还没写。DeepSeek 请在 content.js 的 PERSONALITIES 里补上这个 key。`,
      blindspot: '（盲点待填）',
      twist: '（反转/给暖待填）',
      match: { code: '----', line: '（最佳搭档待填）' },
      hook: '想躺得更安心点？有空来鑫芽逛逛。',
    };
  }
  function renderResult() {
    const res = state.result;
    const code = res.dimensions.code;
    const p = PERSONALITIES[code] || fallbackPersona(code);
    const emoji = TYPE_EMOJI[code] || '💡';
    // 从性格题答案中取城市名
    const cityFeed = state.pAnswers.find(a => a.feed && a.feed.startsWith('city:'))?.feed;
    const cityName = cityFeed ? cityFeed.split(':')[1] : '你的城市';

    root.innerHTML = `
      ${brand()}
      <div class="result-hero reveal d1">
        <div class="result-badge">${code.split('').join('  ')}</div>
        <h2 class="result-title">${emoji}&nbsp;${p.title}</h2>
        ${p.subtitle ? `<div class="result-subtitle">${p.subtitle}</div>` : ''}
      </div>

      <div class="result-quote reveal d2">${p.quote}</div>

      <div class="rank-banner reveal d2">在<b>${cityName}</b>，你的退休速度打败了 <b>${res.cityPercentile}%</b> 的人 🏙️</div>

      ${numbersBlock(res)}

      <div class="radar-wrap reveal d3">${radarSVG(res.dimensions.scores)}</div>

      <div class="insight-card reading reveal d3">
        <div class="section-h">📖 人格剖析</div>
        <div class="reading-text">${p.reading}</div>
      </div>
      <div class="insight-card blindspot reveal d4">
        <div class="section-h">🎯 你的盲点</div>
        <div class="reading-text">${p.blindspot}</div>
      </div>
      <div class="insight-card twist reveal d4">
        <div class="section-h">🫂 但是吧……</div>
        <div class="reading-text">${p.twist}</div>
      </div>

      <div class="match-card reveal d5"><b>${p.match.code}</b>&nbsp;·&nbsp;${p.match.line}</div>

      <div class="hook-box reveal d5">${p.hook}</div>

      <div class="foot-actions reveal d5" id="footActions"></div>
      <p class="tiny">数字基于复利模型和你的关键数据测算，仅供娱乐参考。</p>
      <canvas id="cardCanvas" width="900" height="1400" style="display:none"></canvas>
    `;
    const fa = document.getElementById('footActions');
    if (state.shared) {
      fa.innerHTML = `<button class="btn coral" id="goTest">测测我是哪种 →</button>`;
      document.getElementById('goTest').onclick = () => { location.href = location.pathname; };
    } else {
      fa.innerHTML = `<button class="btn coral" id="save">保存我的结果图，去晒</button>
        <button class="btn" id="shareBtn">复制分享链接</button>
        <button class="btn" id="restart">重测一次</button>`;
      document.getElementById('restart').onclick = () => location.reload();
      document.getElementById('save').onclick = () => buildShareCard(res, p);
      document.getElementById('shareBtn').onclick = () => {
        const link = location.origin + location.pathname + '?r=' + encodeResult(res);
        navigator.clipboard.writeText(link).then(() => {
          const b = document.getElementById('shareBtn'); b.textContent = '已复制！发给朋友吧'; setTimeout(() => { b.textContent = '复制分享链接'; }, 2000);
        }).catch(() => { prompt('复制这个链接发给朋友：', link); });
      };
    }
  }

  /* ---------- 结果图（canvas → 长按保存，微信/桌面端通用）---------- */
  async function buildShareCard(res, p) {
    try {
    const c = document.getElementById('cardCanvas');
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    // 等字体就绪（超时 800ms 防止卡死）
    if (document.fonts && document.fonts.ready) {
      try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 800))]); } catch (_) {}
    }
    // 底
    ctx.fillStyle = '#F2E9D8'; ctx.fillRect(0, 0, W, H);
    // 边框
    ctx.strokeStyle = '#211C16'; ctx.lineWidth = 10; ctx.strokeRect(34, 34, W - 68, H - 68);
    ctx.fillStyle = '#211C16';
    ctx.textAlign = 'center';
    const F = (size, weight = '700') => `${weight} ${size}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif`;

    // logo
    ctx.font = F(36, '900'); ctx.fillStyle = '#FF4D2E'; ctx.fillText('$ 钱格测试', W / 2, 110);
    // code
    ctx.font = F(36, '700'); ctx.fillStyle = '#2E7D6B'; ctx.fillText(res.dimensions.code.split('').join('  '), W / 2, 200);
    // title（56px + 宽边距，防长称号溢出）
    ctx.font = F(56, '900'); ctx.fillStyle = '#211C16';
    wrapText(ctx, p.title, W / 2, 300, W - 200, 64);
    // rank
    ctx.fillStyle = '#E8A33D'; roundRect(ctx, 90, 440, W - 180, 110, 24); ctx.fill();
    ctx.strokeStyle = '#211C16'; ctx.lineWidth = 6; roundRect(ctx, 90, 440, W - 180, 110, 24); ctx.stroke();
    ctx.fillStyle = '#211C16'; ctx.font = F(30, '700');
    const cityFeed2 = state.pAnswers.find(a => a.feed && a.feed.startsWith('city:'))?.feed;
    const cityName2 = cityFeed2 ? cityFeed2.split(':')[1] : '同城';
    ctx.fillText(`退休速度打败了${cityName2}`, W / 2, 490);
    ctx.fillStyle = '#FF4D2E'; ctx.font = F(48, '900');
    ctx.fillText(`${res.cityPercentile}% 的人 🏙️`, W / 2, 535);
    // numbers
    const age = isFinite(res.retirement.achievableRetireAge) ? Math.round(res.retirement.achievableRetireAge) + ' 岁' : '再想想';
    ctx.fillStyle = '#211C16'; ctx.font = F(26, '700'); ctx.fillText('照这个存法，大约能躺平的年纪', W / 2, 640);
    ctx.fillStyle = '#FF4D2E'; ctx.font = F(84, '900'); ctx.fillText(age, W / 2, 730);
    // quote（28px + 更宽边距）
    ctx.fillStyle = '#211C16'; ctx.font = F(26, '400');
    wrapText(ctx, p.quote, W / 2, 860, W - 140, 42);

    // QR 码（动态从 API 加载，扫码复现同一份结果）
    const shareURL = location.origin + location.pathname + '?r=' + encodeResult(res);
    const qrURL = 'https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' + encodeURIComponent(shareURL);
    try {
      const qrImg = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('QR load fail'));
        img.src = qrURL;
      });
      ctx.drawImage(qrImg, W / 2 - 80, H - 260, 160, 160);
      ctx.fillStyle = '#5A5247'; ctx.font = F(20, '400');
      ctx.fillText('长按扫码，测测你是哪种快乐的穷鬼', W / 2, H - 74);
    } catch (_) {
      // QR 加载失败 → 只放文字链接，不崩
      ctx.fillStyle = '#5A5247'; ctx.font = F(20, '400');
      ctx.fillText('长按扫码测测你是哪种快乐的穷鬼', W / 2, H - 110);
      ctx.fillText(shareURL, W / 2, H - 74);
    }

    showSavableImage(c.toDataURL('image/png'));
    } catch (e) { alert('生成图片失败，请重试一次：' + e.message); }
  }

  /* ---------- 长按保存覆盖层（微信/移动端触发系统"保存图片"）---------- */
  function showSavableImage(dataURL) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;overflow:auto;';
    ov.innerHTML = `<p style="color:#fff;font-size:15px;margin:0 0 12px;text-align:center;">长按图片保存到相册 👇</p>
      <img src="${dataURL}" style="max-width:100%;max-height:78vh;border-radius:12px;">
      <button style="margin-top:16px;padding:10px 22px;border:0;border-radius:24px;font-size:15px;">关闭</button>`;
    ov.querySelector('button').onclick = () => ov.remove();
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    document.body.appendChild(ov);
  }
  function wrapText(ctx, text, x, y, maxW, lh) {
    const chars = text.split(''); let line = '', yy = y;
    for (const ch of chars) {
      if (ctx.measureText(line + ch).width > maxW && line) { ctx.fillText(line, x, yy); line = ch; yy += lh; }
      else line += ch;
    }
    ctx.fillText(line, x, yy);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* ---------- 路由 ---------- */
  function render() {
    switch (state.stage) {
      case 'intro': return renderIntro();
      case 'calc': return renderCalc();
      case 'personality': return renderPersonality();
      case 'loading': return renderLoading();
      case 'result': return renderResult();
    }
  }
  const sp = new URLSearchParams(location.search);
  if (sp.has('r')) {
    try {
      state.result = decodeResult(sp.get('r'));
      state.shared = true;
      state.stage = 'result';
    } catch (e) { /* 坏链接就当没有，正常进首页 */ }
  }
  render();
})();
