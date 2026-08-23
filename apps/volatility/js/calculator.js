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
  const p7Forbidden = holdingMinutes !== null && holdingMinutes > 10 &&
    Boolean(input?.noFavorableExcursion) && Boolean(input?.stopHesitation);

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
    p7Complete: holdingMinutes !== null
  };
}
