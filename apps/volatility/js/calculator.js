import { WEEKLY_VOLATILITY_REFERENCE } from "./weekly-reference.generated.js";

export const MNQ_CONTRACT = Object.freeze({
  pointValueUsd: 2,
  tickSize: 0.25
});

export const POSITION_LOSS_RISK_RULES = Object.freeze({
  currentAdverseAtr: 0,
  oneHourMinutes: 60,
  fourHourMinutes: 240,
  fourHourAdverseAtr: -2.25,
  twelveHourMinutes: 720,
  twelveHourAdverseAtr: -1.5,
  twentyFourHourMinutes: 1440
});

export const TAIL_LOSS_AVOIDANCE_EVIDENCE = Object.freeze({
  completedEpisodes: 797,
  lossEpisodes: 60,
  lossEpisodePercent: 7.528,
  grossProfitErosionPercent: 78.321,
  outOfSampleEpisodeRocAuc: 0.778,
  highestRiskBandLossRatePercent: 40,
  highestRiskBandLossDollarSharePercent: 59.325,
  lossMedianCurrentMoveAtr: -1.84,
  nonLossMedianCurrentMoveAtr: -0.17,
  lossMedianHoldingMinutes: 120,
  nonLossMedianHoldingMinutes: 30,
  lossMedianMaeAtr: -3.09,
  nonLossMedianMaeAtr: -1.10,
  lossMedianCurrentQuantity: 3,
  nonLossMedianCurrentQuantity: 2,
  riskClusterMedianMaxQuantity: 6,
  riskClusterMedianAddCount: 3,
  positionInsuranceCap: 5,
  automaticFullExitValidated: false,
  sourceCutoffDate: "2026-08-13"
});

export { WEEKLY_VOLATILITY_REFERENCE };

function finiteNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function roundToTick(value, mode = "nearest", tick = MNQ_CONTRACT.tickSize) {
  const numeric = finiteNumber(value);
  if (numeric === null || numeric < 0 || !Number.isFinite(tick) || tick <= 0) {
    return null;
  }
  const scaled = numeric / tick;
  const rounded = mode === "down" ? Math.floor(scaled + Number.EPSILON) :
    mode === "up" ? Math.ceil(scaled - Number.EPSILON) : Math.round(scaled);
  return Number((rounded * tick).toFixed(8));
}

export function validateMarketBar(candidate) {
  const values = {
    open: finiteNumber(candidate?.open),
    high: finiteNumber(candidate?.high),
    low: finiteNumber(candidate?.low),
    current: finiteNumber(candidate?.current),
    atr5m14: finiteNumber(candidate?.atr5m14)
  };
  const errors = [];

  for (const field of ["open", "high", "low", "current"]) {
    if (values[field] === null || values[field] <= 0) {
      errors.push(`${field}는 0보다 큰 숫자여야 합니다.`);
    } else {
      const tickUnits = values[field] / MNQ_CONTRACT.tickSize;
      if (Math.abs(tickUnits - Math.round(tickUnits)) > 1e-6) {
        errors.push(`${field}는 MNQ 0.25포인트 틱에 맞아야 합니다.`);
      }
    }
  }
  if (errors.length === 0) {
    if (values.high < values.low) errors.push("고가는 저가보다 낮을 수 없습니다.");
    if (values.open > values.high || values.open < values.low) {
      errors.push("시가는 고가와 저가 사이에 있어야 합니다.");
    }
    if (values.current > values.high || values.current < values.low) {
      errors.push("현재가는 고가와 저가 사이에 있어야 합니다.");
    }
  }
  if (values.atr5m14 !== null && values.atr5m14 <= 0) {
    errors.push("5분 ATR(14)은 0보다 커야 합니다.");
  }

  return { valid: errors.length === 0, values, errors };
}

export function calculateWilderAtrFromBars(bars, period = 14) {
  if (!Array.isArray(bars)) throw new TypeError("5분봉 배열이 필요합니다.");
  if (!Number.isInteger(period) || period < 1) throw new TypeError("ATR 기간은 1 이상의 정수여야 합니다.");
  const normalized = bars.map(bar => ({
    high: finiteNumber(bar?.high),
    low: finiteNumber(bar?.low),
    close: finiteNumber(bar?.close)
  }));
  if (normalized.some(bar => bar.high === null || bar.low === null || bar.close === null ||
      bar.high <= 0 || bar.low <= 0 || bar.close <= 0 ||
      bar.high < Math.max(bar.low, bar.close) || bar.low > bar.close)) {
    throw new Error("ATR 계산용 5분봉이 올바르지 않습니다.");
  }
  if (normalized.length < period) return null;
  const trueRanges = normalized.map((bar, index) => {
    const previousClose = normalized[index - 1]?.close;
    return previousClose === undefined
      ? bar.high - bar.low
      : Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of trueRanges.slice(period)) atr = ((atr * (period - 1)) + value) / period;
  return atr;
}

function emaSeries(values, span) {
  const alpha = 2 / (span + 1);
  let current = values[0];
  return values.map((value, index) => {
    if (index > 0) current = alpha * value + (1 - alpha) * current;
    return index + 1 >= span ? current : null;
  });
}

function wilderAtrSeries(bars, period = 14) {
  const trueRanges = bars.map((bar, index) => {
    const previousClose = bars[index - 1]?.close;
    return previousClose === undefined
      ? bar.high - bar.low
      : Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  const result = Array(bars.length).fill(null);
  if (trueRanges.length < period) return result;
  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = atr;
  for (let index = period; index < trueRanges.length; index += 1) {
    atr = ((atr * (period - 1)) + trueRanges[index]) / period;
    result[index] = atr;
  }
  return result;
}

function wilderRsi(closes, period = 14) {
  if (closes.length <= period) return null;
  const changes = closes.slice(1).map((value, index) => value - closes[index]);
  let gain = changes.slice(0, period).reduce((sum, value) => sum + Math.max(value, 0), 0) / period;
  let loss = changes.slice(0, period).reduce((sum, value) => sum + Math.max(-value, 0), 0) / period;
  for (const change of changes.slice(period)) {
    gain = ((gain * (period - 1)) + Math.max(change, 0)) / period;
    loss = ((loss * (period - 1)) + Math.max(-change, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

function normalizedChartBars(bars) {
  if (!Array.isArray(bars)) throw new TypeError("5분봉 배열이 필요합니다.");
  return bars.map(bar => {
    const at = new Date(bar?.at || "");
    const high = finiteNumber(bar?.high);
    const low = finiteNumber(bar?.low);
    const close = finiteNumber(bar?.close);
    if (!Number.isFinite(at.getTime()) || high === null || low === null || close === null ||
        high <= 0 || low <= 0 || close <= 0 || high < close || low > close || high < low) {
      throw new Error("자동 지표 계산용 5분봉이 올바르지 않습니다.");
    }
    return { at: at.toISOString(), high, low, close };
  });
}

export function buildFiveMinuteChartFeatures(bars, { chartWindowBars = 1380 } = {}) {
  const normalized = normalizedChartBars(bars);
  if (!Number.isInteger(chartWindowBars) || chartWindowBars < 1) {
    throw new TypeError("차트 보존 봉 수는 1 이상의 정수여야 합니다.");
  }
  if (normalized.length < 276) return { indicators: null, chart5m: [] };
  const closes = normalized.map(bar => bar.close);
  const atrSeries = wilderAtrSeries(normalized);
  const ema50 = emaSeries(closes, 50).at(-1);
  const ema200 = emaSeries(closes, 200).at(-1);
  const rsi14 = wilderRsi(closes);
  const atrPercentSeries = atrSeries.map((atr, index) => atr === null ? null : atr / closes[index] * 100);
  const currentAtrPercent = atrPercentSeries.at(-1);
  const percentileWindow = atrPercentSeries.filter(value => value !== null).slice(-(276 * 20));
  const atrPercentile20d = currentAtrPercent === null || percentileWindow.length < 276
    ? null
    : percentileWindow.filter(value => value <= currentAtrPercent).length / percentileWindow.length * 100;
  const round = value => value === null ? null : Number(value.toFixed(6));
  const chartStart = Math.max(0, normalized.length - chartWindowBars);
  const chart5m = normalized.slice(chartStart).map((bar, offset) => ({
    ...bar,
    atr14: round(atrSeries[chartStart + offset])
  }));
  return {
    indicators: {
      timeframe: "5m",
      sourceBarAt: normalized.at(-1).at,
      historyBarCount: normalized.length,
      ema50: round(ema50),
      ema200: round(ema200),
      emaRegime: ema50 >= ema200 ? "bullish" : "bearish",
      rsi14: round(rsi14),
      atrPercentile20d: round(atrPercentile20d),
      atrPercentileSampleCount: percentileWindow.length
    },
    chart5m
  };
}

export function calculatePositionPathFeatures(chartBars, position, fallbackAtr = null) {
  if (!Array.isArray(chartBars) || !["long", "short"].includes(position?.direction)) return null;
  const entry = finiteNumber(position?.entry);
  const enteredAt = new Date(position?.enteredAt || "");
  if (entry === null || entry <= 0 || !Number.isFinite(enteredAt.getTime())) return null;
  const path = chartBars.filter(bar => new Date(bar?.at || "").getTime() >= enteredAt.getTime());
  if (!path.length) return null;
  const normalized = normalizedChartBars(path);
  const direction = position.direction === "long" ? 1 : -1;
  const favorable = normalized.map(bar => direction > 0 ? bar.high - entry : entry - bar.low);
  const adverse = normalized.map(bar => direction > 0 ? bar.low - entry : entry - bar.high);
  const entryAtr = finiteNumber(path[0]?.atr14) ?? finiteNumber(fallbackAtr);
  if (entryAtr === null || entryAtr <= 0) return null;
  const atrValues = path.map(bar => finiteNumber(bar?.atr14)).filter(value => value !== null && value > 0);
  const rangePoints = Math.max(...normalized.map(bar => bar.high)) - Math.min(...normalized.map(bar => bar.low));
  return {
    barCount: normalized.length,
    startsAt: normalized[0].at,
    completeFromEntry: new Date(normalized[0].at).getTime() - enteredAt.getTime() <= 5 * 60000,
    mfeAtr: Math.max(...favorable) / entryAtr,
    maeAtr: Math.min(...adverse) / entryAtr,
    rangeAtr: rangePoints / entryAtr,
    volatilityExpansionRatio: atrValues.length
      ? atrValues.reduce((sum, value) => sum + value, 0) / atrValues.length / entryAtr
      : null
  };
}

export function calculateVolatilityScenario(bar, percent) {
  const validation = validateMarketBar(bar);
  const numericPercent = finiteNumber(percent);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  if (numericPercent === null || numericPercent <= 0) {
    throw new Error("변동성 기준은 0보다 커야 합니다.");
  }

  const { open, high, low, current } = validation.values;
  const budgetPoints = open * numericPercent / 100;
  const usedPoints = high - low;
  const remainingPoints = Math.max(0, budgetPoints - usedPoints);
  const usedPercent = budgetPoints > 0 ? usedPoints / budgetPoints * 100 : 0;

  return {
    percent: numericPercent,
    budgetPoints,
    usedPoints,
    remainingPoints,
    usedPercent,
    exhausted: remainingPoints <= 0,
    favorableBoundary: {
      long: roundToTick(current + remainingPoints, "down"),
      short: roundToTick(Math.max(0, current - remainingPoints), "up")
    }
  };
}

// The historical (H-L)/O average above is a descriptive range budget.  A
// reachable-from-open line is a different statistic and must be calibrated
// from the direction-specific open-to-extreme excursion.
export function calculateSafeReachScenario(bar, direction, percent) {
  const validation = validateMarketBar(bar);
  const numericPercent = finiteNumber(percent);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  if (!['bull', 'bear'].includes(direction)) {
    throw new Error("안전측 방향은 bull 또는 bear여야 합니다.");
  }
  if (numericPercent === null || numericPercent <= 0) {
    throw new Error("안전측 도달 기준은 0보다 커야 합니다.");
  }

  const { open, high, low, current } = validation.values;
  const rawMovePoints = open * numericPercent / 100;
  // Keep the line conservative after conversion to the 0.25-point MNQ tick:
  // a bullish line rounds down and a bearish line rounds up.
  const priceLine = direction === 'bull'
    ? roundToTick(open + rawMovePoints, "down")
    : roundToTick(Math.max(0, open - rawMovePoints), "up");
  const movePoints = Math.abs(priceLine - open);
  const observedPoints = direction === 'bull'
    ? Math.max(0, high - open)
    : Math.max(0, open - low);
  const reached = direction === 'bull' ? high >= priceLine : low <= priceLine;
  const remainingFromCurrent = direction === 'bull'
    ? Math.max(0, priceLine - current)
    : Math.max(0, current - priceLine);
  const progressPercent = movePoints > 0 ? observedPoints / movePoints * 100 : 0;

  return {
    direction,
    percent: numericPercent,
    priceLine,
    rawMovePoints,
    movePoints,
    observedPoints,
    remainingFromCurrent,
    progressPercent,
    reached
  };
}

export function calculatePositionScenario(position, bar, scenario) {
  const direction = position?.direction;
  if (!['long', 'short'].includes(direction)) {
    throw new Error("포지션 방향은 long 또는 short여야 합니다.");
  }
  const entry = finiteNumber(position.entry);
  const quantity = finiteNumber(position.quantity);
  const fees = finiteNumber(position.fees) ?? 0;
  const atr = finiteNumber(position.atr5m14 ?? bar?.atr5m14);
  const current = finiteNumber(bar?.current);
  if (entry === null || entry <= 0 || current === null || current <= 0) {
    throw new Error("진입가와 현재가가 필요합니다.");
  }
  if (Math.abs(entry / MNQ_CONTRACT.tickSize - Math.round(entry / MNQ_CONTRACT.tickSize)) > 1e-6) {
    throw new Error("진입가는 MNQ 0.25포인트 틱에 맞아야 합니다.");
  }
  if (quantity === null || quantity < 1 || !Number.isInteger(quantity)) {
    throw new Error("계약 수는 1 이상의 정수여야 합니다.");
  }
  if (fees < 0) throw new Error("수수료는 0 이상이어야 합니다.");
  if (atr === null || atr <= 0) throw new Error("5분 ATR(14)가 필요합니다.");

  const sign = direction === "long" ? 1 : -1;
  const thresholdPrice = finiteNumber(scenario?.priceLine) ??
    finiteNumber(scenario?.favorableBoundary?.[direction]);
  if (thresholdPrice === null || thresholdPrice <= 0) {
    throw new Error("시나리오 가격선이 필요합니다.");
  }
  const stopRaw = entry - sign * atr;
  const stopPrice = roundToTick(
    Math.max(0, stopRaw),
    direction === "long" ? "up" : "down"
  );
  const dollarsPerPoint = quantity * MNQ_CONTRACT.pointValueUsd;
  const currentPoints = sign * (current - entry);
  const projectedPoints = sign * (thresholdPrice - entry);
  const incrementalPoints = sign * (thresholdPrice - current);
  const stopPoints = sign * (stopPrice - entry);

  return {
    direction,
    quantity,
    entry,
    current,
    atr,
    fees,
    thresholdPrice,
    // Backward-compatible name for consumers that still render the original
    // descriptive range-boundary scenario.
    favorableBoundary: thresholdPrice,
    stopPrice,
    currentPoints,
    currentNetUsd: currentPoints * dollarsPerPoint - fees,
    incrementalPoints,
    incrementalGrossUsd: incrementalPoints * dollarsPerPoint,
    projectedPoints,
    projectedNetUsd: projectedPoints * dollarsPerPoint - fees,
    stopPoints,
    stopNetUsd: stopPoints * dollarsPerPoint - fees
  };
}

export function assessPositionLossRisk(position, now = new Date()) {
  const direction = position?.direction;
  const entry = finiteNumber(position?.entry);
  const current = finiteNumber(position?.current);
  const atr = finiteNumber(position?.atr5m14);

  const priceInputsComplete = ["long", "short"].includes(direction) &&
    entry !== null && entry > 0 && current !== null && current > 0 && atr !== null && atr > 0;
  const sign = direction === "long" ? 1 : -1;
  const signedMovePoints = priceInputsComplete ? sign * (current - entry) : null;
  const signedMoveAtr = priceInputsComplete ? signedMovePoints / atr : null;

  const enteredAt = new Date(position?.enteredAt || "");
  const nowDate = new Date(now);
  const rawHoldingMinutes = Number.isFinite(enteredAt.getTime()) && Number.isFinite(nowDate.getTime())
    ? (nowDate.getTime() - enteredAt.getTime()) / 60000
    : null;
  const holdingMinutes = rawHoldingMinutes !== null && rawHoldingMinutes >= 0
    ? rawHoldingMinutes
    : null;
  const timingIssue = rawHoldingMinutes !== null && rawHoldingMinutes < 0 ? "future" :
    rawHoldingMinutes === null ? "missing" : "";

  const timedStatus = (minutes, condition, requiredInputsComplete = true) => {
    if (holdingMinutes === null) return "incomplete";
    if (holdingMinutes < minutes) return "pending";
    if (!requiredInputsComplete) return "incomplete";
    return condition ? "triggered" : "clear";
  };
  const rules = [
    {
      id: "current-adverse-move",
      label: "현재가가 진입가보다 불리한 방향",
      threshold: "손실 위험 진행의 첫 관찰 단계",
      status: signedMoveAtr === null ? "incomplete" :
        signedMoveAtr < POSITION_LOSS_RISK_RULES.currentAdverseAtr ? "triggered" : "clear"
    },
    {
      id: "one-hour-loss",
      label: "1시간 이상 보유 + 현재 손실",
      threshold: "1시간부터 손실 포지션 최초 재점검",
      status: timedStatus(
        POSITION_LOSS_RISK_RULES.oneHourMinutes,
        signedMoveAtr !== null && signedMoveAtr < 0,
        signedMoveAtr !== null
      )
    },
    {
      id: "four-hour-large-loss",
      label: "4시간 이상 + −2.25 ATR 이하",
      threshold: "대형손실 위험: 축소·청산 검토",
      status: timedStatus(
        POSITION_LOSS_RISK_RULES.fourHourMinutes,
        signedMoveAtr !== null && signedMoveAtr <= POSITION_LOSS_RISK_RULES.fourHourAdverseAtr,
        signedMoveAtr !== null
      )
    },
    {
      id: "twelve-hour-loss",
      label: "12시간 이상 + −1.5 ATR 이하",
      threshold: "장시간 손실의 최상위 위험 조합",
      status: timedStatus(
        POSITION_LOSS_RISK_RULES.twelveHourMinutes,
        signedMoveAtr !== null && signedMoveAtr <= POSITION_LOSS_RISK_RULES.twelveHourAdverseAtr,
        signedMoveAtr !== null
      )
    },
    {
      id: "twenty-four-hour-hold",
      label: "24시간 이상 보유",
      threshold: "의무 청산·재진입 분리 검토 후보",
      status: timedStatus(POSITION_LOSS_RISK_RULES.twentyFourHourMinutes, true)
    }
  ];
  const triggeredRuleIds = rules.filter(rule => rule.status === "triggered").map(rule => rule.id);
  const has = id => triggeredRuleIds.includes(id);
  const severity = has("twenty-four-hour-hold") || has("twelve-hour-loss") ? "critical" :
    has("four-hour-large-loss") ? "danger" :
      has("one-hour-loss") ? "caution" :
        has("current-adverse-move") ? "watch" : "safe";

  return {
    severity,
    rules,
    triggeredRuleIds,
    holdingMinutes,
    timingIssue,
    signedMovePoints,
    signedMoveAtr,
    complete: rules.every(rule => rule.status !== "incomplete")
  };
}

function checklistStatus(complete, triggered) {
  if (!complete) return "incomplete";
  return triggered ? "triggered" : "clear";
}

function timedChecklistStatus(holdingMinutes, thresholdMinutes, complete, triggered) {
  if (holdingMinutes === null) return "incomplete";
  if (holdingMinutes < thresholdMinutes) return "pending";
  return checklistStatus(complete, triggered);
}

export function assessTailLossAvoidance(input) {
  const holdingMinutes = finiteNumber(input?.holdingMinutes);
  const signedMoveAtr = finiteNumber(input?.signedMoveAtr);
  const signedMovePoints = finiteNumber(input?.signedMovePoints);
  const entry = finiteNumber(input?.entry);
  const atr = finiteNumber(input?.atr5m14);
  const maeAtr = finiteNumber(input?.maeAtr);
  const currentQuantity = finiteNumber(input?.currentQuantity);
  const maxQuantity = finiteNumber(input?.maxQuantity);
  const addCount = finiteNumber(input?.addCount);
  const direction = input?.direction;
  const pathComplete = input?.pathComplete === true;
  const quantityValid = currentQuantity !== null && Number.isInteger(currentQuantity) && currentQuantity >= 1;
  const maxQuantityValid = maxQuantity !== null && Number.isInteger(maxQuantity) && maxQuantity >= 1;
  const addCountValid = addCount !== null && Number.isInteger(addCount) && addCount >= 0;
  const quantityRelationshipValid = !quantityValid || !maxQuantityValid || maxQuantity >= currentQuantity;
  const priceComplete = ["long", "short"].includes(direction) && entry !== null && entry > 0 &&
    atr !== null && atr > 0 && signedMoveAtr !== null;
  const inputIssues = [];
  if (quantityValid && maxQuantityValid && !quantityRelationshipValid) {
    inputIssues.push("최대 계약 수는 현재 계약 수보다 작을 수 없습니다.");
  }

  const criticalEscalation = holdingMinutes !== null && signedMoveAtr !== null && (
    (holdingMinutes >= POSITION_LOSS_RISK_RULES.fourHourMinutes &&
      signedMoveAtr <= POSITION_LOSS_RISK_RULES.fourHourAdverseAtr) ||
    (holdingMinutes >= POSITION_LOSS_RISK_RULES.twelveHourMinutes &&
      signedMoveAtr <= POSITION_LOSS_RISK_RULES.twelveHourAdverseAtr) ||
    holdingMinutes >= POSITION_LOSS_RISK_RULES.twentyFourHourMinutes
  );
  const rules = [
    {
      id: "current-adverse-move",
      label: "현재가가 진입가보다 불리한 방향",
      threshold: "초기 경고 · 불리한 변동이 시작되면 추가 진입 근거부터 재검토",
      weight: 1,
      status: checklistStatus(signedMoveAtr !== null, signedMoveAtr !== null && signedMoveAtr < 0)
    },
    {
      id: "loss-median-move",
      label: "현재 변동 −1.84 ATR 이하",
      threshold: "손실 거래 중앙값 −1.84 ATR · 비손실 −0.17 ATR",
      weight: 2,
      status: checklistStatus(
        signedMoveAtr !== null,
        signedMoveAtr !== null && signedMoveAtr <= TAIL_LOSS_AVOIDANCE_EVIDENCE.lossMedianCurrentMoveAtr
      )
    },
    {
      id: "two-hour-loss",
      label: "2시간 이상 보유 + 현재 손실",
      threshold: "손실 거래 경과시간 중앙값 120분 · 비손실 30분",
      weight: 1,
      status: timedChecklistStatus(
        holdingMinutes,
        TAIL_LOSS_AVOIDANCE_EVIDENCE.lossMedianHoldingMinutes,
        signedMoveAtr !== null,
        signedMoveAtr !== null && signedMoveAtr < 0
      )
    },
    {
      id: "deep-path-mae",
      label: "경로 MAE −3.09 ATR 이하",
      threshold: "손실 거래 MAE 중앙값 −3.09 ATR · 비손실 −1.10 ATR",
      weight: 2,
      status: checklistStatus(
        pathComplete && maeAtr !== null,
        pathComplete && maeAtr !== null && maeAtr <= TAIL_LOSS_AVOIDANCE_EVIDENCE.lossMedianMaeAtr
      )
    },
    {
      id: "current-size-three",
      label: "현재 3계약 이상",
      threshold: "손실 스냅샷 현재 계약 중앙값 3 · 비손실 2",
      weight: 1,
      status: checklistStatus(quantityValid, quantityValid && currentQuantity >= 3)
    },
    {
      id: "max-size-six",
      label: "거래 중 최대 6계약 이상",
      threshold: "위험 군집 중앙값 6 · 5계약 상한은 낙폭 보험 후보",
      weight: 2,
      status: checklistStatus(
        maxQuantityValid && quantityRelationshipValid,
        maxQuantityValid && quantityRelationshipValid && maxQuantity >= 6
      )
    },
    {
      id: "three-adds",
      label: "추가 진입 3회 이상",
      threshold: "장기 버티기·대형화 위험 군집의 추가 진입 중앙값 3회",
      weight: 2,
      status: checklistStatus(addCountValid, addCountValid && addCount >= 3)
    },
    {
      id: "time-loss-escalation",
      label: "4시간·−2.25 ATR / 12시간·−1.5 ATR / 24시간",
      threshold: "하나라도 해당하면 적색 단계 · 자동청산이 아닌 즉시 수동 재평가",
      weight: 3,
      status: holdingMinutes === null ? "incomplete" :
        holdingMinutes < POSITION_LOSS_RISK_RULES.fourHourMinutes ? "pending" :
          checklistStatus(signedMoveAtr !== null, criticalEscalation)
    }
  ];
  const triggeredRules = rules.filter(rule => rule.status === "triggered");
  const knownRules = rules.filter(rule => !["incomplete"].includes(rule.status));
  const riskPoints = triggeredRules.reduce((sum, rule) => sum + rule.weight, 0);
  const complete = rules.every(rule => rule.status !== "incomplete") && inputIssues.length === 0;
  const sign = direction === "long" ? 1 : direction === "short" ? -1 : null;
  const lossMedianPrice = priceComplete && sign !== null
    ? roundToTick(entry + sign * TAIL_LOSS_AVOIDANCE_EVIDENCE.lossMedianCurrentMoveAtr * atr)
    : null;
  const fourHourRiskPrice = priceComplete && sign !== null
    ? roundToTick(entry + sign * POSITION_LOSS_RISK_RULES.fourHourAdverseAtr * atr)
    : null;
  const currentGrossUsd = quantityValid && signedMovePoints !== null
    ? signedMovePoints * currentQuantity * MNQ_CONTRACT.pointValueUsd
    : null;
  const experimentalStopGate = holdingMinutes === null || currentGrossUsd === null ? null :
    holdingMinutes >= 60 && currentGrossUsd <= -500;
  const severity = criticalEscalation || experimentalStopGate === true || riskPoints >= 9 ? "critical" :
    riskPoints >= 6 ? "danger" : riskPoints >= 3 ? "caution" :
      riskPoints >= 1 ? "watch" : "safe";
  const actions = {
    critical: "추가 진입을 금지하고 현재 손절 계획에 따라 즉시 축소·청산을 재평가하세요. 모델만으로 자동 전량청산하지는 마세요.",
    danger: "추가 진입을 중단하고 계약 수 축소와 손절 실행 조건을 우선 확인하세요.",
    caution: "새 추가 진입을 보류하고 −1.84 ATR 관찰선과 시간 위험 단계를 확인하세요.",
    watch: "손실 확대 여부를 관찰하고 추가 진입 전 체크리스트를 다시 확인하세요.",
    safe: "현재 확인 가능한 조건은 미해당입니다. 입력 누락이 있으면 안전 판정으로 사용하지 마세요."
  };

  return {
    severity,
    complete,
    rules,
    triggeredRuleIds: triggeredRules.map(rule => rule.id),
    triggeredCount: triggeredRules.length,
    knownCount: knownRules.length,
    totalCount: rules.length,
    riskPoints,
    maxRiskPoints: rules.reduce((sum, rule) => sum + rule.weight, 0),
    inputIssues,
    action: actions[severity],
    currentGrossUsd,
    lossMedianPrice,
    fourHourRiskPrice,
    experimentalStopGate,
    automaticFullExitValidated: TAIL_LOSS_AVOIDANCE_EVIDENCE.automaticFullExitValidated
  };
}

export function classifySnapshotStatus(snapshot, now = new Date()) {
  if (snapshot?.mode === "manual") {
    return { key: "manual", label: "수동 입력", ageMinutes: null };
  }
  // A request timestamp says when we downloaded the payload, not how fresh the
  // market observation is.  Yahoo's CME values are delayed, so freshness must
  // be measured from the last source bar and must fail closed when it is absent.
  const observedAt = new Date(snapshot?.market?.latestBarAt || "");
  const requestedAt = new Date(snapshot?.generatedAt || "");
  if (!Number.isFinite(observedAt.getTime())) {
    return { key: "error", label: "시각 불명", ageMinutes: null };
  }
  const rawAgeMinutes = (now.getTime() - observedAt.getTime()) / 60000;
  if (rawAgeMinutes < -5) {
    return { key: "error", label: "미래 시각 오류", ageMinutes: rawAgeMinutes };
  }
  const ageMinutes = Math.max(0, rawAgeMinutes);
  const requestAgeMinutes = Number.isFinite(requestedAt.getTime())
    ? Math.max(0, (now.getTime() - requestedAt.getTime()) / 60000)
    : null;
  if (ageMinutes <= 25) {
    return { key: "delayed", label: "약 10분 지연 참고", ageMinutes, requestAgeMinutes };
  }
  if (ageMinutes <= 45) {
    return { key: "aging", label: "지연 참고 · 갱신 늦음", ageMinutes, requestAgeMinutes };
  }
  return { key: "stale", label: "오래된 데이터", ageMinutes };
}

export const LIVE_TRADE_PATTERN_PROFILES = Object.freeze([
  Object.freeze({ number: 1, cluster: 0, name: "짧고 단순한 안정형", historicalSharePercent: 30.2 }),
  Object.freeze({ number: 2, cluster: 1, name: "고변동 단기 대응형", historicalSharePercent: 25.2 }),
  Object.freeze({ number: 3, cluster: 2, name: "장기 버티기·대형화 위험형", historicalSharePercent: 15.1 }),
  Object.freeze({ number: 4, cluster: 3, name: "중기 추세 포착형", historicalSharePercent: 29.5 })
]);

export function classifyLiveTradePattern(input) {
  const holdingMinutes = finiteNumber(input?.holdingMinutes);
  const signedMoveAtr = finiteNumber(input?.signedMoveAtr);
  const atrPercentile = finiteNumber(input?.atrPercentile);
  const maeAtr = finiteNumber(input?.maeAtr);
  const mfeAtr = finiteNumber(input?.mfeAtr);
  if (holdingMinutes === null || holdingMinutes < 0 || signedMoveAtr === null) return null;

  let cluster;
  const evidence = [];
  if (holdingMinutes >= 720 || signedMoveAtr <= -2.25 || (maeAtr !== null && maeAtr <= -4)) {
    cluster = 2;
    if (holdingMinutes >= 720) evidence.push("12시간 이상 보유");
    if (signedMoveAtr <= -2.25) evidence.push(`현재 ${signedMoveAtr.toFixed(2)} ATR 손실`);
    if (maeAtr !== null && maeAtr <= -4) evidence.push(`경로 최대불리변동 ${maeAtr.toFixed(2)} ATR`);
  } else if (holdingMinutes <= 60 && atrPercentile !== null && atrPercentile >= 75) {
    cluster = 1;
    evidence.push("60분 이내 단기 보유", `ATR 백분위 ${atrPercentile.toFixed(1)}`);
  } else if (holdingMinutes <= 60) {
    cluster = 0;
    evidence.push("60분 이내 단기 보유", "고변동 기준 미해당");
  } else if (holdingMinutes >= 240 && signedMoveAtr < 0) {
    cluster = 2;
    evidence.push("4시간 이상 보유", "현재 불리한 방향");
  } else {
    cluster = 3;
    evidence.push("60분 초과 중기 보유");
    if (signedMoveAtr > 0) evidence.push(`현재 +${signedMoveAtr.toFixed(2)} ATR`);
    if (mfeAtr !== null && mfeAtr >= 1.5) evidence.push(`최대유리변동 +${mfeAtr.toFixed(2)} ATR`);
  }
  const profile = LIVE_TRADE_PATTERN_PROFILES.find(item => item.cluster === cluster);
  const cautions = {
    0: "짧은 보유가 길어지거나 추가 진입으로 바뀌면 이 경향은 즉시 약해집니다.",
    1: "고변동 구간에서는 추격 진입·슬리피지·손절폭 확대를 특히 경계하세요.",
    2: "과거 평균 손익이 음수였던 위험 군집입니다. 추가 진입을 멈추고 축소·청산 기준을 우선 확인하세요.",
    3: "유리한 변동을 반납하거나 보유가 12시간을 넘으면 위험형으로 전이될 수 있습니다."
  };
  return {
    ...profile,
    evidence,
    caution: cautions[cluster],
    confidence: input?.pathComplete && atrPercentile !== null ? "중간" : "낮음",
    isRiskPattern: cluster === 2
  };
}

export function classifyPatternRisk(input, now = new Date()) {
  const atrPercentile = finiteNumber(input?.atrPercentile);
  const rsi1h = finiteNumber(input?.rsi1h);
  const highVol = atrPercentile !== null && atrPercentile >= 75;
  const emaBearish = input?.ema1h === "bearish";
  const rsiBearish = rsi1h !== null && rsi1h < 45;
  const bearishRegime = emaBearish || rsiBearish;
  const p6Forbidden = highVol && bearishRegime;
  const globalKillSwitch = highVol || bearishRegime;
  const highVolKnown = atrPercentile !== null;
  const bearishKnownFalse = input?.ema1h === "bullish" && rsi1h !== null && rsi1h >= 45;

  const enteredAt = new Date(input?.enteredAt || "");
  const holdingMinutes = Number.isFinite(enteredAt.getTime())
    ? Math.max(0, (now.getTime() - enteredAt.getTime()) / 60000)
    : null;
  const mfeAtr = finiteNumber(input?.mfeAtr);
  const p7Forbidden = holdingMinutes !== null && holdingMinutes > 10 &&
    mfeAtr !== null && mfeAtr < 0.25;

  return {
    highVol,
    bearishRegime,
    emaBearish,
    rsiBearish,
    p6Forbidden,
    globalKillSwitch,
    holdingMinutes,
    p7Forbidden,
    p6Complete: highVolKnown && (!highVol || bearishRegime || bearishKnownFalse),
    killComplete: globalKillSwitch || (highVolKnown && bearishKnownFalse),
    p7Complete: holdingMinutes !== null && mfeAtr !== null
  };
}
