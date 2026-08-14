import assert from "node:assert/strict";
import test from "node:test";
import {
  MNQ_CONTRACT,
  WEEKLY_VOLATILITY_REFERENCE,
  calculatePositionScenario,
  calculateSafeReachScenario,
  calculateVolatilityScenario,
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

test("평균 범위·조건부 선·실전 ex-ante 선의 검증 계약을 고정한다", () => {
  const reference = WEEKLY_VOLATILITY_REFERENCE;
  assert.equal(reference.effectiveFrom, "2026-08-10");
  assert.equal(reference.effectiveThrough, "2026-08-16");
  assert.equal(reference.directions.bull.rangeMeanPercent, 1.7578587562480577);
  assert.equal(reference.directions.bear.rangeMeanPercent, 1.9687778988774758);
  assert.equal(reference.directions.bull.safePercent, 0.7079938023472419);
  assert.equal(reference.directions.bear.safePercent, 0.8152825513548078);
  assert.equal(reference.exAnte.up.safePercent, 0.3595381228038516);
  assert.equal(reference.exAnte.down.safePercent, 0.29505120096620113);
  assert.equal(reference.exAnte.up.walkForwardSampleCount, 253);
  assert.equal(reference.exAnte.down.walkForwardSampleCount, 253);
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

test("P7은 10분 초과·무반응·손절 주저가 모두 있을 때만 경고한다", () => {
  const now = new Date("2026-08-13T12:20:00Z");
  const base = { enteredAt: "2026-08-13T12:09:00Z", noFavorableExcursion: true, stopHesitation: true };
  assert.equal(classifyPatternRisk(base, now).p7Forbidden, true);
  assert.equal(classifyPatternRisk({ ...base, stopHesitation: false }, now).p7Forbidden, false);
});
