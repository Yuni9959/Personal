export const MNQ_CONTRACT = Object.freeze({
  pointValueUsd: 2,
  tickSize: 0.25
});

export const WEEKLY_VOLATILITY_REFERENCE = Object.freeze({
  effectiveFrom: "2026-08-10",
  effectiveThrough: "2026-08-16",
  calculatedAt: "2026-08-10",
  sourceSymbol: "NQ continuous proxy",
  sourceDataset: "nasdaq_daily.csv",
  method: "최근 5년 일봉의 (H-L)/O×100, 방향별 2σ 범위 내 관측치 평균",
  bullPercent: 1.758,
  bearPercent: 1.969
});

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
  if (quantity === null || quantity < 1 || !Number.isInteger(quantity)) {
    throw new Error("계약 수는 1 이상의 정수여야 합니다.");
  }
  if (fees < 0) throw new Error("수수료는 0 이상이어야 합니다.");
  if (atr === null || atr <= 0) throw new Error("5분 ATR(14)가 필요합니다.");

  const sign = direction === "long" ? 1 : -1;
  const favorableBoundary = scenario.favorableBoundary[direction];
  const stopRaw = entry - sign * atr;
  const stopPrice = roundToTick(
    Math.max(0, stopRaw),
    direction === "long" ? "up" : "down"
  );
  const dollarsPerPoint = quantity * MNQ_CONTRACT.pointValueUsd;
  const currentPoints = sign * (current - entry);
  const projectedPoints = sign * (favorableBoundary - entry);
  const incrementalPoints = Math.max(0, sign * (favorableBoundary - current));
  const stopPoints = sign * (stopPrice - entry);

  return {
    direction,
    quantity,
    entry,
    current,
    atr,
    fees,
    favorableBoundary,
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
  const generatedAt = new Date(snapshot?.generatedAt || "");
  if (!Number.isFinite(generatedAt.getTime())) {
    return { key: "error", label: "시각 불명", ageMinutes: null };
  }
  const ageMinutes = Math.max(0, (now.getTime() - generatedAt.getTime()) / 60000);
  if (ageMinutes <= 30) return { key: "delayed", label: "지연 프록시 · 신규", ageMinutes };
  if (ageMinutes <= 240) return { key: "aging", label: "지연 프록시 · 갱신 지연", ageMinutes };
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
