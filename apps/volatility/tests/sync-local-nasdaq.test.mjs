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
