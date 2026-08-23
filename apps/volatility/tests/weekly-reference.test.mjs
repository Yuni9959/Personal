import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  buildWeeklyReference,
  currentKstWeek,
  renderReferenceModule,
  sigmaClean,
  wilsonInterval
} from "../tools/build-weekly-reference.mjs";

function syntheticDailyCsv() {
  const lines = ["Date,Close,High,Low,Open,Volume"];
  const end = Date.parse("2026-08-24T00:00:00Z");
  let index = 0;
  for (let time = Date.parse("2018-01-01T00:00:00Z"); time < end; time += 86_400_000) {
    const date = new Date(time);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    const open = 10000 + index * 0.5;
    const upPercent = 0.2 + (index % 20) * 0.05;
    const downPercent = 0.25 + ((index * 7) % 20) * 0.05;
    const high = open * (1 + upPercent / 100);
    const low = open * (1 - downPercent / 100);
    const close = open * (1 + (index % 2 === 0 ? 0.05 : -0.05) / 100);
    lines.push([
      `${date.toISOString().slice(0, 10)} 00:00:00+00:00`,
      close.toFixed(8), high.toFixed(8), low.toFixed(8), open.toFixed(8), 1000 + index
    ].join(","));
    index += 1;
  }
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

test("한국 날짜의 월요일 자정에서 자동 주간 경계를 전환한다", () => {
  assert.deepEqual(currentKstWeek(new Date("2026-08-23T14:59:59.999Z")), {
    today: "2026-08-23",
    effectiveFrom: "2026-08-17",
    effectiveThrough: "2026-08-23"
  });
  assert.deepEqual(currentKstWeek(new Date("2026-08-23T15:00:00.000Z")), {
    today: "2026-08-24",
    effectiveFrom: "2026-08-24",
    effectiveThrough: "2026-08-30"
  });
});

test("2σ 1회 정제와 Wilson 95% 구간을 재현한다", () => {
  const audit = sigmaClean([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 100]);
  assert.equal(audit.raw.length, 11);
  assert.equal(audit.used.length, 10);
  assert.equal(audit.cleanMean, 1);
  const [low, high] = wilsonInterval(75, 100);
  assert.ok(Math.abs(low - 0.656955364519384) < 1e-12);
  assert.ok(Math.abs(high - 0.8245478863771232) < 1e-12);
});

test("오늘 기준 직전 5년만 사용해 주간 앱 계약 모듈을 생성한다", () => {
  const source = syntheticDailyCsv();
  const reference = buildWeeklyReference(source, {
    now: new Date("2026-08-24T00:30:00+09:00"),
    sourceName: "fixture.csv"
  });
  assert.equal(reference.effectiveFrom, "2026-08-24");
  assert.equal(reference.effectiveThrough, "2026-08-30");
  assert.equal(reference.fitStart, "2021-08-24");
  assert.equal(reference.fitEndExclusive, "2026-08-24");
  assert.equal(reference.holdoutStart, "2025-08-25");
  assert.equal(reference.sourceSha256, crypto.createHash("sha256").update(source).digest("hex"));
  for (const line of [
    reference.directions.bull,
    reference.directions.bear,
    reference.exAnte.up,
    reference.exAnte.down
  ]) {
    assert.ok(line.safePercent > 0);
    assert.ok(line.selectionWilson95Low >= 70);
    assert.ok(line.walkForwardSampleCount > 0);
  }
  const moduleSource = renderReferenceModule(reference);
  assert.match(moduleSource, /직접 수정하지 마세요/);
  assert.match(moduleSource, /export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze/);
});
