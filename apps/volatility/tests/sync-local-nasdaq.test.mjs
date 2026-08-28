import assert from "node:assert/strict";
import test from "node:test";

import { sessionSnapshot } from "../tools/sync-local-nasdaq.mjs";

const BAR_MS = 5 * 60_000;

function sessionBars(startIso, { leadingMissing = 0, price = 30000 } = {}) {
  const start = new Date(startIso).getTime();
  return Array.from({ length: 276 - leadingMissing }, (_, index) => {
    const offset = index + leadingMissing;
    const open = price + offset * 0.25;
    return {
      at: new Date(start + offset * BAR_MS),
      open,
      high: open + 1,
      low: open - 1,
      close: open + 0.25,
      volume: 1
    };
  });
}

test("최근 완료 세션의 시작 2봉 결손은 이전 세션으로 후퇴하지 않고 첫 관측 기준가로 보존한다", () => {
  const older = sessionBars("2026-08-20T22:00:00.000Z", { price: 29000 });
  const recent = sessionBars("2026-08-23T22:00:00.000Z", {
    leadingMissing: 2,
    price: 30000
  });
  const sourceBytes = Buffer.from("synthetic-nasdaq-5m", "utf8");
  const result = sessionSnapshot(
    [...older, ...recent],
    "C:\\fixture\\nasdaq_5m.csv",
    sourceBytes,
    new Date("2026-08-25T06:00:00.000Z")
  );

  assert.equal(result.session.start, "2026-08-23T22:00:00.000Z");
  assert.equal(result.session.firstObservedAt, "2026-08-23T22:10:00.000Z");
  assert.equal(result.session.lastObservedAt, "2026-08-24T20:55:00.000Z");
  assert.equal(result.session.barCount, 274);
  assert.equal(result.session.expectedBarCount, 276);
  assert.equal(result.provider.leadingMissingBucketCount, 2);
  assert.equal(result.provider.firstObservedBarAt, "2026-08-23T22:10:00.000Z");
  assert.equal(result.provider.missingInteriorBucketCount, 0);
  assert.equal(result.market.open, 30000.5);
  assert.equal(result.market.latestBarAt, "2026-08-24T20:55:00.000Z");
});

test("시작 결손이 없는 정상 완료 세션도 첫 관측시각을 세션 시작으로 검증한다", () => {
  const recent = sessionBars("2026-08-25T22:00:00.000Z", { price: 30000 });
  const result = sessionSnapshot(
    recent,
    "C:\\fixture\\nasdaq_5m.csv",
    Buffer.from("complete-session", "utf8"),
    new Date("2026-08-27T06:00:00.000Z")
  );

  assert.equal(result.session.start, "2026-08-25T22:00:00.000Z");
  assert.equal(result.session.firstObservedAt, result.session.start);
  assert.equal(result.provider.leadingMissingBucketCount, 0);
  assert.equal(result.provider.firstObservedBarAt, result.session.start);
  assert.equal(result.provider.missingInteriorBucketCount, 0);
  assert.equal(result.provider.barQuality, "complete");
});

test("완료 세션의 중간 1봉 결손은 이후 연속봉으로 ATR을 다시 계산한다", () => {
  const recent = sessionBars("2026-08-25T22:00:00.000Z", { price: 30000 });
  recent.splice(100, 1);
  const result = sessionSnapshot(
    recent,
    "C:\\fixture\\nasdaq_5m.csv",
    Buffer.from("one-interior-gap", "utf8"),
    new Date("2026-08-27T06:00:00.000Z")
  );

  assert.equal(result.provider.leadingMissingBucketCount, 0);
  assert.equal(result.provider.missingInteriorBucketCount, 1);
  assert.equal(result.provider.missingInteriorBucketAt, "2026-08-26T06:20:00.000Z");
  assert.equal(result.provider.barQuality, "one-interior-missing-bucket");
  assert.equal(result.provider.atrSourceBarCount, 175);
  assert.ok(result.market.atr5m14 > 0);
  assert.equal(result.market.atrLastCompletedBarAt, result.market.latestBarAt);
});
