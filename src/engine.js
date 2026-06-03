/* ============================================================
 * engine.js — 钱格测试 核心引擎（数字保真，绝不娱乐化）
 * ------------------------------------------------------------
 * 这是整个产品的信任根基。外壳尽情玩，这里的数必须真。
 *
 * 【分工】这部分由框架作者写好，DeepSeek 不用动。
 * 上线时如要接入「鑫芽现成的复利引擎」，只需保证
 *   computeRetirement(inputs) 的【输入/输出契约】不变即可替换。
 *
 * 所有可调假设集中在 CONFIG，方便上线后按真实分布微调。
 * ============================================================ */

const CONFIG = {
  // —— 复利假设（保守、可辩护；用实际收益率，金额按今天的购买力计）——
  annualRealReturn: 0.04,   // 累积期年化"真实"收益率（已含通胀折算）
  withdrawalRate: 0.04,     // 退休后安全提取率（4% 法则）：所需本金 = 年支出 / 该值

  // —— 维度判定阈值（先拍一版，对应 content/dimensions.md，上线看真实分布再调）——
  // 新维度字母：E/L 起步 · R/C 储蓄 · M/B 本金 · H/S 物欲
  thresholds: {
    earlyYears: 20,         // 距退休 ≥20 年 → E(早),否则 L(晚) — v3 已同步原型
    saveMonthly: 2000,      // 每月能存 ≥2000 → R(能存)，否则 C(月光)
    principal: 100000,      // 现有存款 ≥10万 → M(有底)，否则 B(白手)
    spendMonthly: 8000,     // 期望退休月花 ≥8000 → H(高物欲)，否则 S(低物欲)
  },

  // —— 同城排名（B 方案：预设正态分布，把"退休速度"分数映射成百分位）——
  // 参数校准目标：让多数人落在 40%~85% 的"体面带"，避免动不动 1% 太扎人。
  // 上线拿到真实分布后再调这两个值即可。
  ranking: {
    baselineRetireAge: 65,  // 基准退休年龄：你能比它早多少 → 打败越多人（调高=普遍更体面）
    spreadYears: 16,        // 分布"标准差"（年）。越大，排名越平缓、两极越少
  },
};

/* ---------- 工具：标准正态 CDF（无依赖，erf 近似）---------- */
function normalCDF(z) {
  // Abramowitz & Stegun 7.1.26 近似 erf
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 + 0.5 * y : 0.5 - 0.5 * y;
}

/* ============================================================
 * 核心计算：computeRetirement
 * ------------------------------------------------------------
 * 输入契约（5 道核心计算题）：
 *   currentAge        现在多大（岁）
 *   retireAge         想几岁退休（岁）
 *   monthlyRetireSpend退休后想每月花多少（元/月，今天购买力）
 *   monthlySave       现在每月大概能存多少（元/月）
 *   currentSavings    现在手头有多少存款（元）
 *
 * 输出契约：
 *   targetCorpus            退休所需本金（元）
 *   achievableRetireAge     按现在的存法，几岁能退休（岁；可能为 Infinity）
 *   canReachWantedAge       想退的年龄够不够（true/false）
 *   monthlySaveNeeded       想按时退休，每月该存多少（元/月）
 *   gapMonthly              每月缺口 = 该存 - 能存（元/月；>0 表示要再加点）
 * ============================================================ */
function computeRetirement(inputs) {
  const { currentAge, retireAge, monthlyRetireSpend, monthlySave, currentSavings } = inputs;

  const r = CONFIG.annualRealReturn;
  const mr = r / 12; // 月利率
  const targetCorpus = (monthlyRetireSpend * 12) / CONFIG.withdrawalRate;

  // 给定月份数 n，按月复利的本利和
  const fv = (n, save) =>
    currentSavings * Math.pow(1 + mr, n) +
    (mr === 0
      ? save * n
      : save * ((Math.pow(1 + mr, n) - 1) / mr));

  // —— 输出1：按"现在能存的"，几岁能退休（逐月推进找到达标点）——
  let achievableRetireAge = Infinity;
  const maxAge = 100;
  for (let n = 0; n <= (maxAge - currentAge) * 12; n++) {
    if (fv(n, monthlySave) >= targetCorpus) {
      achievableRetireAge = currentAge + n / 12;
      break;
    }
  }

  // —— 输出2：想按 retireAge 退休，每月该存多少 ——
  const n = Math.max(0, (retireAge - currentAge) * 12);
  const fromPrincipal = currentSavings * Math.pow(1 + mr, n);
  let monthlySaveNeeded = 0;
  if (fromPrincipal < targetCorpus) {
    const annuityFactor = mr === 0 ? n : (Math.pow(1 + mr, n) - 1) / mr;
    monthlySaveNeeded = annuityFactor > 0 ? (targetCorpus - fromPrincipal) / annuityFactor : Infinity;
  }

  const canReachWantedAge =
    isFinite(achievableRetireAge) && achievableRetireAge <= retireAge;
  const gapMonthly = isFinite(monthlySaveNeeded)
    ? Math.max(0, monthlySaveNeeded - monthlySave)
    : Infinity;

  return {
    targetCorpus: Math.round(targetCorpus),
    achievableRetireAge: isFinite(achievableRetireAge)
      ? Math.round(achievableRetireAge * 10) / 10
      : Infinity,
    canReachWantedAge,
    monthlySaveNeeded: isFinite(monthlySaveNeeded) ? Math.round(monthlySaveNeeded) : Infinity,
    gapMonthly,
  };
}

/* ============================================================
 * 四维度判定 → 四字母人格码
 * 返回 { code:'LSPA', dims:{start, save, principal, ambition}, scores }
 * scores 为 0~1，用于雷达图
 * ============================================================ */
/* ============================================================
 * 四维度判定 → 四字母人格码
 * ------------------------------------------------------------
 * 设计：计算题打底（70% 权重，主导）+ 性格题摇摆票（30% 权重，微调）
 *   - 退休年龄/该存多少/排名 完全不受性格题影响（数字保真红线）
 *   - 只有"人格码"会被性格题影响 —— 让用户答的性格题真正有用
 * 入参 personalityFeeds: 性格题选中选项的 feed 数组，如 ['R','C','H',...]
 *   （'city:'、'egg:' 开头的不参与维度，忽略）
 * 返回 { code, dims, scores }
 * ============================================================ */
function computeDimensions(inputs, personalityFeeds) {
  const t = CONFIG.thresholds;
  const yearsToRetire = inputs.retireAge - inputs.currentAge;

  // —— 第一步：计算题给"基础分" 0~1（0.5 为分界）——
  // 用 sigmoid-like 归一：值=阈值时正好 0.5，越远离阈值越接近 0 或 1
  const baseScore = (val, threshold) => {
    // 以阈值为中点，threshold 本身映射到 0.5；用平滑曲线避免突变
    const ratio = val / threshold;            // 1 = 正好在阈值
    return Math.max(0.02, Math.min(0.98, 0.5 * Math.pow(ratio, 0.7)));
  };
  // 每维基础分（>0.5 偏向第一个字母）
  let s = {
    start:     baseScore(yearsToRetire, t.earlyYears),       // 高→E
    save:      baseScore(inputs.monthlySave, t.saveMonthly), // 高→R
    principal: baseScore(inputs.currentSavings, t.principal),// 高→M
    desire:    baseScore(inputs.monthlyRetireSpend, t.spendMonthly), // 高→H
  };

  // —— 第二步：性格题"摇摆票"微调（每票 ±0.06，封顶 ±0.3 总影响）——
  // feed 字母含义：E↔L(start) · R↔C(save) · M↔B(principal) · H↔S(desire)
  const VOTE = 0.06, CAP = 0.30;
  if (Array.isArray(personalityFeeds)) {
    const tally = { start:0, save:0, principal:0, desire:0 };
    personalityFeeds.forEach((f) => {
      if (!f || f.indexOf(':') >= 0) return;   // 跳过 city: / egg:
      if (f === 'E') tally.start += 1;     else if (f === 'L') tally.start -= 1;
      else if (f === 'R') tally.save += 1; else if (f === 'C') tally.save -= 1;
      else if (f === 'M') tally.principal += 1; else if (f === 'B') tally.principal -= 1;
      else if (f === 'H') tally.desire += 1;    else if (f === 'S') tally.desire -= 1;
    });
    Object.keys(tally).forEach((k) => {
      const adj = Math.max(-CAP, Math.min(CAP, tally[k] * VOTE));
      s[k] = Math.max(0.02, Math.min(0.98, s[k] + adj));
    });
  }

  // —— 第三步：分数 → 字母 ——
  const start     = s.start     >= 0.5 ? 'E' : 'L';
  const save      = s.save      >= 0.5 ? 'R' : 'C';
  const principal = s.principal >= 0.5 ? 'M' : 'B';
  const desire    = s.desire    >= 0.5 ? 'H' : 'S';

  // scores 用于雷达/属性条视觉，clamp 到 [0.08, 1]
  const clamp01 = (x) => Math.max(0.08, Math.min(1, x));
  const scores = {
    start: clamp01(s.start), save: clamp01(s.save),
    principal: clamp01(s.principal), desire: clamp01(s.desire),
  };

  return {
    code: start + save + principal + desire,
    dims: { start, save, principal, desire },
    scores,
  };
}

/* ============================================================
 * 同城排名（B 方案）：退休速度 → 百分位
 * "在你所在的城市，你的退休速度打败了 X% 的人"
 * ============================================================ */
function computeRanking(retirementResult) {
  const { baselineRetireAge, spreadYears } = CONFIG.ranking;
  const age = isFinite(retirementResult.achievableRetireAge)
    ? retirementResult.achievableRetireAge
    : baselineRetireAge + spreadYears * 2; // 退不了的人排在很后面
  // 退得越早 → z 越大 → 打败越多人
  const z = (baselineRetireAge - age) / spreadYears;
  let pct = Math.round(normalCDF(z) * 100);
  pct = Math.max(12, Math.min(96, pct)); // 地板 12%、天花板 96%：再惨也留点体面，再强也别太装
  return pct;
}

/* ---------- 双收益率：按给定年化算退休年龄/每月该存 ---------- */
function retireAgeAt(inputs, annualReturn) {
  const { currentAge, monthlyRetireSpend, monthlySave, currentSavings } = inputs;
  const mr = annualReturn / 12;
  const target = (monthlyRetireSpend * 12) / CONFIG.withdrawalRate;
  const fv = (n) =>
    currentSavings * Math.pow(1 + mr, n) +
    (mr === 0 ? monthlySave * n : monthlySave * ((Math.pow(1 + mr, n) - 1) / mr));
  const maxAge = 100;
  for (let n = 0; n <= (maxAge - currentAge) * 12; n++) {
    if (fv(n) >= target) return currentAge + n / 12;
  }
  return Infinity;
}
function monthlyNeededAt(inputs, annualReturn) {
  const { currentAge, retireAge, monthlyRetireSpend, currentSavings } = inputs;
  const mr = annualReturn / 12;
  const target = (monthlyRetireSpend * 12) / CONFIG.withdrawalRate;
  const n = Math.max(0, (retireAge - currentAge) * 12);
  const fromP = currentSavings * Math.pow(1 + mr, n);
  if (fromP >= target) return 0;
  const af = mr === 0 ? n : (Math.pow(1 + mr, n) - 1) / mr;
  return af > 0 ? (target - fromP) / af : Infinity;
}

/* ---------- 一次性算全部，给 UI 用 ---------- */
function analyze(inputs, personalityFeeds) {
  const retirement = computeRetirement(inputs);
  const dimensions = computeDimensions(inputs, personalityFeeds);
  // 排名按合理理财(10%)算，给人希望
  const r10 = retireAgeAt(inputs, 0.10);
  const ageForRank = isFinite(r10) ? r10 : CONFIG.ranking.baselineRetireAge + 32;
  const z = (CONFIG.ranking.baselineRetireAge - ageForRank) / CONFIG.ranking.spreadYears;
  let pct = Math.round(normalCDF(z) * 100);
  pct = Math.max(12, Math.min(96, pct));
  return {
    inputs,
    retirement,
    dimensions,
    cityPercentile: pct,
    r2: retireAgeAt(inputs, 0.02),
    r10,
    need2: monthlyNeededAt(inputs, 0.02),
    need10: monthlyNeededAt(inputs, 0.10),
  };
}

window.QGEngine = { analyze, computeRetirement, computeDimensions, computeRanking, CONFIG };
