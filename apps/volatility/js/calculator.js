import { WEEKLY_VOLATILITY_REFERENCE } from "./weekly-reference.generated.js";

export const MNQ_CONTRACT = Object.freeze({
  pointValueUsd: 2,
  tickSize: 0.25
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
