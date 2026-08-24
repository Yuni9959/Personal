import assert from "node:assert/strict";
import test from "node:test";
import {
  MNQ_CONTRACT,
  POSITION_LOSS_RISK_RULES,
  WEEKLY_VOLATILITY_REFERENCE,
  assessPositionLossRisk,
  buildFiveMinuteChartFeatures,
  calculatePositionPathFeatures,
  calculatePositionScenario,
  calculateSafeReachScenario,
  calculateVolatilityScenario,
  calculateWilderAtrFromBars,
  classifyLiveTradePattern,
  classifyPatternRisk,
  classifySnapshotStatus,
  roundToTick,
  validateMarketBar
} from "../js/calculator.js";

const bar = { open: 30000, high: 30100, low: 29800, current: 30000, atr5m14: 20 };

test("MNQ 승수와 tick을 CME 계약값으로 고정한다", () => {
  assert.deepEqual(MNQ_CONTRACT, { pointValueUsd: 2, tickSize: 0.25 });
  assert.equal(roundToTick(100.12, "down"), 100);
  assert.equal(roundToTick(100.12, "up"), 100.25);
  assert.equal(roundToTick(100.13), 100.25);
});

test("자동 생성된 평균 범위·조건부 선·실전 ex-ante 계약의 구조와 주간 경계를 고정한다", () => {
  const reference = WEEKLY_VOLATILITY_REFERENCE;
  const from = new Date(`${reference.effectiveFrom}T00:00:00Z`);
  const through = new Date(`${reference.effectiveThrough}T00:00:00Z`);
  const fitStart = new Date(`${reference.fitStart}T00:00:00Z`);
  assert.equal(from.getUTCDay(), 1);
  assert.equal((through - from) / 86_400_000, 6);
  assert.equal(reference.fitEndExclusive, reference.effectiveFrom);
  assert.equal(fitStart.getUTCFullYear(), from.getUTCFullYear() - 5);
  assert.equal(reference.sourceDataset, "nasdaq_daily.csv");
  assert.match(reference.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(reference), true);
  assert.equal(Object.isFrozen(reference.exAnte), true);
  for (const line of [
    reference.directions.bull,
    reference.directions.bear,
    reference.exAnte.up,
    reference.exAnte.down
  ]) {
    assert.ok(line.safePercent > 0);
    assert.ok([0.10, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50].includes(line.safeQuantile));
    assert.ok(line.selectionWilson95Low >= 70);
    assert.ok(line.walkForwardSampleCount > 0);
    assert.ok(line.walkForwardHitRate >= 0 && line.walkForwardHitRate <= 100);
    assert.ok(line.walkForwardWilson95Low <= line.walkForwardHitRate);
    assert.ok(line.walkForwardWilson95High >= line.walkForwardHitRate);
  }
  assert.equal(reference.directions.bull.rangeMeanPercent, reference.bullPercent);
  assert.equal(reference.directions.bear.rangeMeanPercent, reference.bearPercent);
  assert.equal(reference.rejectedIllustration.percent, 1.409);
});

test("양봉·음봉 범위 예산과 소진률을 독립적으로 계산한다", () => {
  const bull = calculateVolatilityScenario(bar, 1.758);
  const bear = calculateVolatilityScenario(bar, 1.969);
  assert.equal(bull.budgetPoints, 527.4);
  assert.equal(bull.usedPoints, 300);
  assert.ok(Math.abs(bull.remainingPoints - 227.4) < 1e-10);
  assert.equal(bull.favorableBoundary.long, 30227.25);
  assert.equal(bull.favorableBoundary.short, 29772.75);
  assert.equal(bear.budgetPoints, 590.7);
  assert.ok(bear.remainingPoints > bull.remainingPoints);
});

test("범위를 이미 초과했을 때 남은 범위를 음수로 만들지 않는다", () => {
  const result = calculateVolatilityScenario({ ...bar, high: 30600, low: 29400 }, 1.758);
  assert.equal(result.remainingPoints, 0);
  assert.equal(result.exhausted, true);
  assert.ok(result.usedPercent > 100);
});

test("안전측 도달선은 평균 H-L 예산과 섞지 않고 시가에서 방향별로 계산한다", () => {
  const bull = calculateSafeReachScenario(bar, "bull", 1.409);
  const bear = calculateSafeReachScenario(bar, "bear", 1.512);
  assert.equal(bull.rawMovePoints, 422.7);
  assert.equal(bull.priceLine, 30422.5);
  assert.equal(bull.movePoints, 422.5);
  assert.equal(bull.reached, false);
  assert.equal(bull.remainingFromCurrent, 422.5);
  assert.equal(bear.rawMovePoints, 453.6);
  assert.equal(bear.priceLine, 29546.5);
  assert.equal(bear.movePoints, 453.5);
  assert.equal(bear.reached, false);
});

test("MNQ tick 변환은 안전측 선을 더 어려운 방향으로 밀지 않는다", () => {
  const uneven = { open: 30000.25, high: 30100, low: 29800, current: 30000, atr5m14: 20 };
  const bull = calculateSafeReachScenario(uneven, "bull", 1);
  const bear = calculateSafeReachScenario(uneven, "bear", 1);
  assert.ok(bull.priceLine <= uneven.open * 1.01);
  assert.ok(bear.priceLine >= uneven.open * 0.99);
});

test("오류가 있는 O/H/L/current를 조용히 보정하지 않는다", () => {
  assert.equal(validateMarketBar({ open: 30000, high: 29900, low: 29800, current: 30000 }).valid, false);
  assert.equal(validateMarketBar({ open: 30000, high: 30100, low: 29800, current: 30200 }).valid, false);
});

test("MNQ 가격은 0.25포인트 틱에 맞지 않으면 거부한다", () => {
  const result = validateMarketBar({
    open: 30000, high: 30100, low: 29900, current: 30000.1, atr5m14: 20
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /0\.25포인트 틱/);
});

test("최신 연속 완료 5분봉으로 Wilder ATR(14)을 자동 계산한다", () => {
  const bars = Array.from({ length: 20 }, (_, index) => ({
    high: 102 + index,
    low: 99 + index,
    close: 100 + index
  }));
  assert.equal(calculateWilderAtrFromBars(bars), 3);
  assert.equal(calculateWilderAtrFromBars(bars.slice(0, 13)), null);
  assert.throws(() => calculateWilderAtrFromBars([{ high: 102, low: 101, close: 100 }]), /올바르지 않습니다/);
});

test("완료 5분봉에서 EMA50·EMA200·RSI14·ATR 백분위와 포지션 경로를 자동 계산한다", () => {
  const bars = Array.from({ length: 400 }, (_, index) => ({
    at: new Date(Date.parse("2026-08-20T00:00:00Z") + index * 300000).toISOString(),
    high: 30002 + index * 0.25,
    low: 29998 + index * 0.25,
    close: 30000 + index * 0.25
  }));
  const result = buildFiveMinuteChartFeatures(bars, { chartWindowBars: 100 });
  assert.equal(result.indicators.timeframe, "5m");
  assert.equal(result.indicators.emaRegime, "bullish");
  assert.ok(result.indicators.ema50 > result.indicators.ema200);
  assert.ok(result.indicators.rsi14 >= 99);
  assert.ok(result.indicators.atrPercentile20d >= 0);
  assert.equal(result.chart5m.length, 100);
  const path = calculatePositionPathFeatures(result.chart5m, {
    direction: "long", entry: bars[320].close, enteredAt: bars[320].at
  }, 4);
  assert.ok(path.mfeAtr > 0);
  assert.ok(path.maeAtr <= 0);
  assert.equal(path.completeFromEntry, true);
});

test("포지션 상한 가정과 1 ATR 손절을 MNQ $2/point로 계산한다", () => {
  const scenario = calculateVolatilityScenario(bar, 1.758);
  const result = calculatePositionScenario({
    direction: "long", entry: 29900, quantity: 2, fees: 4, atr5m14: 20
  }, bar, scenario);
  assert.equal(result.currentNetUsd, 396);
  assert.equal(result.incrementalGrossUsd, 909);
  assert.equal(result.projectedNetUsd, 1305);
  assert.equal(result.stopPrice, 29880);
  assert.equal(result.stopNetUsd, -84);
});

test("포지션 진입가는 0.25 tick을 강제하지만 ATR 평균은 소수 정밀도를 허용한다", () => {
  const scenario = calculateVolatilityScenario(bar, 1.758);
  assert.throws(() => calculatePositionScenario({
    direction: "long", entry: 29900.1, quantity: 1, fees: 0, atr5m14: 40.34778
  }, bar, scenario), /0\.25포인트 틱/);
  const valid = calculatePositionScenario({
    direction: "long", entry: 29900.25, quantity: 1, fees: 0, atr5m14: 40.34778
  }, bar, scenario);
  assert.equal(valid.atr, 40.34778);
});

test("포지션 손실 위험의 다섯 경계값을 고정한다", () => {
  assert.deepEqual(POSITION_LOSS_RISK_RULES, {
    currentAdverseAtr: 0,
    oneHourMinutes: 60,
    fourHourMinutes: 240,
    fourHourAdverseAtr: -2.25,
    twelveHourMinutes: 720,
    twelveHourAdverseAtr: -1.5,
    twentyFourHourMinutes: 1440
  });
});

test("1시간 손실과 4시간 −2.25 ATR 경계를 방향성 변동으로 판정한다", () => {
  const now = new Date("2026-08-24T12:00:00Z");
  const oneHour = assessPositionLossRisk({
    direction: "long", entry: 30000, current: 29999.75, atr5m14: 20,
    enteredAt: "2026-08-24T11:00:00Z"
  }, now);
  assert.equal(oneHour.signedMoveAtr, -0.0125);
  assert.equal(oneHour.rules[0].status, "triggered");
  assert.equal(oneHour.rules[1].status, "triggered");
  assert.equal(oneHour.rules[2].status, "pending");
  assert.equal(oneHour.severity, "caution");

  const fourHourShort = assessPositionLossRisk({
    direction: "short", entry: 30000, current: 30045, atr5m14: 20,
    enteredAt: "2026-08-24T08:00:00Z"
  }, now);
  assert.equal(fourHourShort.signedMoveAtr, -2.25);
  assert.equal(fourHourShort.rules[2].status, "triggered");
  assert.equal(fourHourShort.severity, "danger");
});

test("12시간 손실과 24시간 보유는 청산 권고 단계로 올린다", () => {
  const now = new Date("2026-08-24T12:00:00Z");
  const twelveHour = assessPositionLossRisk({
    direction: "long", entry: 30000, current: 29970, atr5m14: 20,
    enteredAt: "2026-08-24T00:00:00Z"
  }, now);
  assert.equal(twelveHour.rules[3].status, "triggered");
  assert.equal(twelveHour.severity, "critical");

  const twentyFourHour = assessPositionLossRisk({
    direction: "long", entry: 30000, current: 30020, atr5m14: 20,
    enteredAt: "2026-08-23T12:00:00Z"
  }, now);
  assert.equal(twentyFourHour.rules[4].status, "triggered");
  assert.equal(twentyFourHour.severity, "critical");
});

test("체결 직후 불리한 방향은 관찰 단계로 표시한다", () => {
  const result = assessPositionLossRisk({
    direction: "long", entry: 30000, current: 29995, atr5m14: 20,
    enteredAt: "2026-08-24T11:50:00Z"
  }, new Date("2026-08-24T12:00:00Z"));
  assert.equal(result.rules[0].status, "triggered");
  assert.equal(result.rules[1].status, "pending");
  assert.equal(result.severity, "watch");
});

test("진입 시각 누락·미래값은 시간 규칙을 안전으로 오판하지 않는다", () => {
  const base = { direction: "long", entry: 30000, current: 30020, atr5m14: 20 };
  const missing = assessPositionLossRisk(base, new Date("2026-08-24T12:00:00Z"));
  assert.equal(missing.complete, false);
  assert.equal(missing.rules[0].status, "clear");
  assert.equal(missing.rules[1].status, "incomplete");
  const future = assessPositionLossRisk({ ...base, enteredAt: "2026-08-24T12:01:00Z" }, new Date("2026-08-24T12:00:00Z"));
  assert.equal(future.timingIssue, "future");
  assert.equal(future.rules[4].status, "incomplete");
});

test("안전측 가격선의 포지션 손익은 기대수익이 아닌 부호 있는 임계선 시나리오다", () => {
  const safeBear = calculateSafeReachScenario(bar, "bear", 1);
  const result = calculatePositionScenario({
    direction: "long", entry: 29900, quantity: 1, fees: 2, atr5m14: 20
  }, bar, safeBear);
  assert.equal(result.thresholdPrice, 29700);
  assert.equal(result.incrementalPoints, -300);
  assert.equal(result.incrementalGrossUsd, -600);
  assert.equal(result.projectedNetUsd, -402);
});

test("순시세 스냅샷은 실시간으로 표시하지 않는다", () => {
  const now = new Date("2026-08-13T12:30:00Z");
  const snapshot = latestBarAt => ({
    generatedAt: "2026-08-13T12:29:00Z",
    market: { latestBarAt }
  });
  const delayed = classifySnapshotStatus(snapshot("2026-08-13T12:10:00Z"), now);
  assert.equal(delayed.key, "delayed");
  assert.equal(delayed.label, "약 10분 지연 참고");
  assert.equal(delayed.ageMinutes, 20);
  assert.equal(delayed.requestAgeMinutes, 1);
  assert.equal(classifySnapshotStatus(snapshot("2026-08-13T12:00:00Z"), now).key, "aging");
  assert.equal(classifySnapshotStatus(snapshot("2026-08-13T10:00:00Z"), now).key, "stale");
  assert.equal(classifySnapshotStatus({ generatedAt: "2026-08-13T12:29:00Z" }, now).key, "error");
  assert.equal(classifySnapshotStatus(snapshot("2026-08-13T12:40:00Z"), now).key, "error");
  assert.equal(classifySnapshotStatus({ mode: "manual" }, now).key, "manual");
});

test("P6 AND 분류와 OR Kill Switch를 구분한다", () => {
  const killOnly = classifyPatternRisk({ ema1h: "bullish", rsi1h: 50, atrPercentile: 75 });
  assert.equal(killOnly.p6Forbidden, false);
  assert.equal(killOnly.globalKillSwitch, true);
  const p6 = classifyPatternRisk({ ema1h: "bearish", rsi1h: 50, atrPercentile: 80 });
  assert.equal(p6.p6Forbidden, true);
  assert.equal(p6.globalKillSwitch, true);
});

test("저변동성은 P6 AND를 미해당으로 확정하지만 OR 규칙은 나머지 입력까지 보류한다", () => {
  const result = classifyPatternRisk({ ema1h: "unknown", rsi1h: "", atrPercentile: 50 });
  assert.equal(result.p6Forbidden, false);
  assert.equal(result.p6Complete, true);
  assert.equal(result.globalKillSwitch, false);
  assert.equal(result.killComplete, false);
});

test("P7은 10분 초과 뒤 차트상 최대유리변동이 0.25 ATR 미만이면 자동 경고한다", () => {
  const now = new Date("2026-08-13T12:20:00Z");
  const base = { enteredAt: "2026-08-13T12:09:00Z", mfeAtr: 0.2 };
  assert.equal(classifyPatternRisk(base, now).p7Forbidden, true);
  assert.equal(classifyPatternRisk({ ...base, mfeAtr: 0.3 }, now).p7Forbidden, false);
  assert.equal(classifyPatternRisk({ enteredAt: base.enteredAt }, now).p7Complete, false);
});

test("현재 관측값으로 네 가지 완결 거래 군집의 경향을 번호로 분류한다", () => {
  assert.equal(classifyLiveTradePattern({ holdingMinutes: 15, signedMoveAtr: 0.5, atrPercentile: 50 }).number, 1);
  assert.equal(classifyLiveTradePattern({ holdingMinutes: 15, signedMoveAtr: 0.5, atrPercentile: 80 }).number, 2);
  const risk = classifyLiveTradePattern({ holdingMinutes: 730, signedMoveAtr: -1, atrPercentile: 50 });
  assert.equal(risk.number, 3);
  assert.equal(risk.isRiskPattern, true);
  assert.equal(classifyLiveTradePattern({ holdingMinutes: 150, signedMoveAtr: 1.5, atrPercentile: 50 }).number, 4);
});
