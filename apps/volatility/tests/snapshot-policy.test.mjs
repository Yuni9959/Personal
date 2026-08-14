import assert from "node:assert/strict";
import test from "node:test";
import { assessSnapshot, referenceExpiryReason } from "../js/snapshot-policy.js";

const now = new Date("2026-08-14T06:30:00.000Z");
const reference = { effectiveFrom: "2026-08-10", effectiveThrough: "2026-08-16" };

function snapshot({
  ageMinutes = 10,
  mode,
  requestedSymbol = "MNQ=F",
  returnedSymbol = "MNQ=F",
  tier = "mnq-continuous-proxy"
} = {}) {
  return {
    mode,
    provider: {
      requestedSymbol,
      returnedSymbol,
      tier,
      ...(mode === "manual" ? {
        actualContractConfirmed: true,
        confirmedAt: new Date(now.getTime() - ageMinutes * 60000).toISOString()
      } : {})
    },
    market: {
      open: 30000,
      high: 30100,
      low: 29900,
      current: 30050,
      atr5m14: 20,
      latestBarAt: new Date(now.getTime() - ageMinutes * 60000).toISOString()
    }
  };
}

test("MNQ 프록시의 25분 경계는 허용하고 바로 다음 순간부터 잠근다", () => {
  assert.equal(assessSnapshot(snapshot({ ageMinutes: 25 }), now, reference).usable, true);
  const stale = assessSnapshot(snapshot({ ageMinutes: 25.001 }), now, reference);
  assert.equal(stale.usable, false);
  assert.equal(stale.key, "stale");
});

test("수동 확인값도 25분 뒤 만료되어 영구 fresh로 승격되지 않는다", () => {
  assert.equal(assessSnapshot(snapshot({ mode: "manual", ageMinutes: 24.9 }), now, reference).usable, true);
  const stale = assessSnapshot(snapshot({ mode: "manual", ageMinutes: 26 }), now, reference);
  assert.equal(stale.usable, false);
  assert.match(stale.reason, /수동 확인값/);
});

test("NQ 대체·알 수 없는 심볼·오염된 tier를 계산 입력으로 허용하지 않는다", () => {
  assert.equal(assessSnapshot(snapshot({
    requestedSymbol: "NQ=F", returnedSymbol: "NQ=F", tier: "nq-continuous-fallback-proxy"
  }), now, reference).usable, false);
  assert.equal(assessSnapshot(snapshot({
    requestedSymbol: "EVIL", returnedSymbol: "EVIL", tier: undefined
  }), now, reference).usable, false);
  const missingTier = snapshot();
  delete missingTier.provider.tier;
  assert.equal(assessSnapshot(missingTier, now, reference).usable, false);
  assert.equal(assessSnapshot(snapshot({ tier: "unknown-tier" }), now, reference).usable, false);
});

test("미래시각과 만료된 주간 기준은 fail-closed한다", () => {
  assert.equal(assessSnapshot(snapshot({ ageMinutes: 0 }), now, reference).usable, true);
  assert.equal(assessSnapshot(snapshot({ ageMinutes: -0.001 }), now, reference).usable, false);
  const expired = { effectiveFrom: "2026-08-03", effectiveThrough: "2026-08-09" };
  const result = assessSnapshot(snapshot(), now, expired);
  assert.equal(result.usable, false);
  assert.match(result.reason, /만료/);
  assert.match(referenceExpiryReason(now, expired), /만료/);
});

test("수동값은 실제 MNQ 월물 확인 기록과 동일한 확인시각이 있어야 한다", () => {
  const missingConfirmation = snapshot({ mode: "manual" });
  delete missingConfirmation.provider.actualContractConfirmed;
  assert.equal(assessSnapshot(missingConfirmation, now, reference).usable, false);

  const mismatchedTime = snapshot({ mode: "manual" });
  mismatchedTime.provider.confirmedAt = new Date(now.getTime() - 11 * 60000).toISOString();
  assert.equal(assessSnapshot(mismatchedTime, now, reference).usable, false);
});

test("가격·원천시각이 없거나 OHLC 불변식을 깨면 잠근다", () => {
  const missingTime = snapshot();
  delete missingTime.market.latestBarAt;
  assert.equal(assessSnapshot(missingTime, now, reference).usable, false);
  const invalid = snapshot();
  invalid.market.current = 30200;
  assert.equal(assessSnapshot(invalid, now, reference).usable, false);
});
