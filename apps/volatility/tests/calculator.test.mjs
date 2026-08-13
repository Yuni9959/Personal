import assert from "node:assert/strict";
import test from "node:test";
import {
  MNQ_CONTRACT,
  calculatePositionScenario,
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

test("오류가 있는 O/H/L/current를 조용히 보정하지 않는다", () => {
  assert.equal(validateMarketBar({ open: 30000, high: 29900, low: 29800, current: 30000 }).valid, false);
  assert.equal(validateMarketBar({ open: 30000, high: 30100, low: 29800, current: 30200 }).valid, false);
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

test("순시세 스냅샷은 실시간으로 표시하지 않는다", () => {
  const now = new Date("2026-08-13T12:30:00Z");
  assert.equal(classifySnapshotStatus({ generatedAt: "2026-08-13T12:10:00Z" }, now).key, "delayed");
  assert.equal(classifySnapshotStatus({ generatedAt: "2026-08-13T10:00:00Z" }, now).key, "aging");
  assert.equal(classifySnapshotStatus({ generatedAt: "2026-08-12T12:00:00Z" }, now).key, "stale");
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
