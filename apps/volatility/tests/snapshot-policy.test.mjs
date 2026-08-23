import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_REFERENCE_SOURCE_AGE_MINUTES,
  assessSnapshot,
  referenceExpiryReason
} from "../js/snapshot-policy.js";

const now = new Date("2026-08-14T06:30:00.000Z");
const reference = { effectiveFrom: "2026-08-10", effectiveThrough: "2026-08-16" };

function snapshot({
  assessedAt = now,
  ageMinutes = 10,
  latestAt,
  sessionStart = "2026-08-13T22:00:00.000Z",
  sessionEnd = "2026-08-14T21:00:00.000Z",
  sessionStatus = "in-progress",
  mode,
  requestedSymbol = "MNQ=F",
  returnedSymbol = "MNQ=F",
  tier = "mnq-continuous-proxy"
} = {}) {
  const sourceAt = latestAt || new Date(assessedAt.getTime() - ageMinutes * 60000).toISOString();
  return {
    mode,
    provider: {
      requestedSymbol,
      returnedSymbol,
      tier,
      sourceEventAt: sourceAt,
      ...(mode === "manual" ? {
        actualContractConfirmed: true,
        confirmedAt: sourceAt
      } : {})
    },
    ...(mode === "manual" ? {} : {
      session: {
        start: sessionStart,
        end: sessionEnd,
        status: sessionStatus,
        isCompletedAtFetch: sessionStatus === "completed",
        lastObservedAt: sourceAt
      }
    }),
    market: {
      open: 30000,
      high: 30100,
      low: 29900,
      current: 30050,
      atr5m14: 20,
      latestBarAt: sourceAt
    }
  };
}

test("진행 세션의 25분 경계만 거래 계산을 허용한다", () => {
  const fresh = assessSnapshot(snapshot({ ageMinutes: 25 }), now, reference);
  assert.equal(fresh.usable, true);
  assert.equal(fresh.calculationAllowed, true);
  assert.equal(fresh.displayable, true);
  assert.equal(fresh.referenceOnly, false);
  assert.equal(fresh.marketState, "active");

  const stale = assessSnapshot(snapshot({ ageMinutes: 25.001 }), now, reference);
  assert.equal(stale.usable, false);
  assert.equal(stale.calculationAllowed, false);
  assert.equal(stale.displayable, false);
  assert.equal(stale.referenceOnly, false);
  assert.equal(stale.marketState, "active-stale");
});

test("토요일에는 종료 5분 이내까지 관측된 최근 완료 세션만 참고값으로 연다", () => {
  const saturday = new Date("2026-08-15T00:50:00.000Z");
  const completed = snapshot({
    assessedAt: saturday,
    latestAt: "2026-08-14T20:59:59.000Z",
    sessionStart: "2026-08-13T22:00:00.000Z",
    sessionEnd: "2026-08-14T21:00:00.000Z",
    // A cached request made just before the close may still say in-progress;
    // the current policy derives completion from the verified time boundary.
    sessionStatus: "in-progress"
  });
  const result = assessSnapshot(completed, saturday, reference);
  assert.equal(result.usable, false);
  assert.equal(result.calculationAllowed, false);
  assert.equal(result.displayable, true);
  assert.equal(result.referenceOnly, true);
  assert.equal(result.referenceLineCalculationAllowed, true);
  assert.equal(result.key, "reference");
  assert.equal(result.marketState, "completed-session");
  assert.equal(result.sessionEndedAt, "2026-08-14T21:00:00.000Z");
  assert.match(result.reason, /자동 ATR 포지션 위험 복기 외의 손절·실전 계산에는 사용하지 않습니다/);
});

test("v3.3 캐시는 sourceEventAt 일치 검증 후 완료 세션 참고값으로 안전 호환한다", () => {
  const saturday = new Date("2026-08-15T00:50:00.000Z");
  const legacy = snapshot({
    assessedAt: saturday,
    latestAt: "2026-08-14T20:59:59.000Z",
    sessionStart: "2026-08-13T22:00:00.000Z",
    sessionEnd: "2026-08-14T21:00:00.000Z",
    sessionStatus: "in-progress"
  });
  delete legacy.session.lastObservedAt;
  assert.equal(assessSnapshot(legacy, saturday, reference).referenceOnly, true);

  legacy.provider.sourceEventAt = "2026-08-14T20:58:59.000Z";
  const conflicting = assessSnapshot(legacy, saturday, reference);
  assert.equal(conflicting.displayable, false);
  assert.equal(conflicting.referenceOnly, false);
});

test("평일 휴장에도 같은 주간 기준이 유효하면 최근 완료 세션을 참고할 수 있다", () => {
  const holidayWednesday = new Date("2026-08-19T14:00:00.000Z");
  const extendedReference = { effectiveFrom: "2026-08-17", effectiveThrough: "2026-08-23" };
  const priorSession = snapshot({
    assessedAt: holidayWednesday,
    latestAt: "2026-08-18T20:59:59.000Z",
    sessionStart: "2026-08-17T22:00:00.000Z",
    sessionEnd: "2026-08-18T21:00:00.000Z",
    sessionStatus: "completed"
  });
  const result = assessSnapshot(priorSession, holidayWednesday, extendedReference);
  assert.equal(result.marketState, "completed-session");
  assert.equal(result.referenceOnly, true);
  assert.equal(result.calculationAllowed, false);
});

test("새 주 월요일에는 이전 주의 최근 완료 세션을 기준시각이 있는 읽기 전용 가격선으로 연다", () => {
  const monday = new Date("2026-08-17T14:00:00.000Z");
  const newReference = { effectiveFrom: "2026-08-17", effectiveThrough: "2026-08-23" };
  const priorWeek = snapshot({
    assessedAt: monday,
    latestAt: "2026-08-14T20:59:59.000Z",
    sessionStart: "2026-08-13T22:00:00.000Z",
    sessionEnd: "2026-08-14T21:00:00.000Z",
    sessionStatus: "completed"
  });
  const result = assessSnapshot(priorWeek, monday, newReference);
  assert.equal(result.usable, false);
  assert.equal(result.calculationAllowed, false);
  assert.equal(result.displayable, true);
  assert.equal(result.referenceOnly, true);
  assert.equal(result.referenceLineCalculationAllowed, true);
  assert.equal(result.marketState, "completed-session");
  assert.match(result.reason, /가격 원천일/);
  assert.match(result.reason, /현재 주간 기준을 최근 세션 시가에 환산한 읽기 전용 참고선/);
});

test("종료됐더라도 마지막 5분 구간이 없으면 완료 세션으로 승격하지 않는다", () => {
  const saturday = new Date("2026-08-15T00:50:00.000Z");
  const incomplete = snapshot({
    assessedAt: saturday,
    latestAt: "2026-08-14T20:54:59.000Z",
    sessionStart: "2026-08-13T22:00:00.000Z",
    sessionEnd: "2026-08-14T21:00:00.000Z",
    sessionStatus: "ended-incomplete"
  });
  const result = assessSnapshot(incomplete, saturday, reference);
  assert.equal(result.usable, false);
  assert.equal(result.displayable, false);
  assert.equal(result.referenceOnly, false);
  assert.equal(result.marketState, "ended-incomplete");
});

test("최근 완료 세션 참고값은 96시간 경계에서 닫힌다", () => {
  const latestAt = "2026-08-14T20:59:00.000Z";
  const exactBoundary = new Date(Date.parse(latestAt) + MAX_REFERENCE_SOURCE_AGE_MINUTES * 60000);
  const wideReference = { effectiveFrom: "2026-08-10", effectiveThrough: "2026-08-23" };
  const priorSession = snapshot({
    assessedAt: exactBoundary,
    latestAt,
    sessionStart: "2026-08-13T22:00:00.000Z",
    sessionEnd: "2026-08-14T21:00:00.000Z",
    sessionStatus: "completed"
  });
  assert.equal(assessSnapshot(priorSession, exactBoundary, wideReference).referenceOnly, true);

  const afterBoundary = new Date(exactBoundary.getTime() + 1);
  const expired = assessSnapshot(priorSession, afterBoundary, wideReference);
  assert.equal(expired.displayable, false);
  assert.equal(expired.referenceOnly, false);
  assert.equal(expired.marketState, "reference-expired");
});

test("주간 기준은 effectiveThrough의 KST 자정 경계에서 fail-close한다", () => {
  const beforeKstMidnight = new Date("2026-08-16T14:59:59.999Z");
  const atKstMidnight = new Date("2026-08-16T15:00:00.000Z");
  assert.equal(referenceExpiryReason(beforeKstMidnight, reference), "");
  assert.match(referenceExpiryReason(atKstMidnight, reference), /만료/);

  const priorSession = snapshot({
    assessedAt: beforeKstMidnight,
    latestAt: "2026-08-14T20:59:59.000Z",
    sessionStart: "2026-08-13T22:00:00.000Z",
    sessionEnd: "2026-08-14T21:00:00.000Z",
    sessionStatus: "completed"
  });
  assert.equal(assessSnapshot(priorSession, beforeKstMidnight, reference).referenceOnly, true);
  const expired = assessSnapshot(priorSession, atKstMidnight, reference);
  assert.equal(expired.usable, false);
  assert.equal(expired.displayable, false);
  assert.equal(expired.referenceLineCalculationAllowed, false);
  assert.equal(expired.marketState, "reference-expired");
});

test("수동 확인값은 25분 안에서만 허용하며 완료 세션 참고값으로 승격하지 않는다", () => {
  const fresh = assessSnapshot(snapshot({ mode: "manual", ageMinutes: 24.9 }), now, reference);
  assert.equal(fresh.usable, true);
  assert.equal(fresh.marketState, "active-manual");

  const stale = assessSnapshot(snapshot({ mode: "manual", ageMinutes: 26 }), now, reference);
  assert.equal(stale.usable, false);
  assert.equal(stale.displayable, false);
  assert.equal(stale.referenceOnly, false);
  assert.equal(stale.marketState, "manual-stale");
  assert.match(stale.reason, /수동 확인값/);
});

test("NQ 대체값·미승인 tier·세션 위조는 미리보기에도 사용하지 않는다", () => {
  const nq = assessSnapshot(snapshot({
    requestedSymbol: "NQ=F", returnedSymbol: "NQ=F", tier: "nq-continuous-fallback-proxy"
  }), now, reference);
  assert.equal(nq.displayable, false);

  const missingTier = snapshot();
  delete missingTier.provider.tier;
  assert.equal(assessSnapshot(missingTier, now, reference).displayable, false);

  const mismatchedSession = snapshot();
  mismatchedSession.session.lastObservedAt = "2026-08-14T06:19:00.000Z";
  assert.equal(assessSnapshot(mismatchedSession, now, reference).displayable, false);
});

test("승인된 로컬 NQ 보관값은 완료 세션 참고로만 표시한다", () => {
  const saturday = new Date("2026-08-22T12:00:00.000Z");
  const currentReference = { effectiveFrom: "2026-08-17", effectiveThrough: "2026-08-23" };
  const local = snapshot({
    mode: "local-archive",
    assessedAt: saturday,
    latestAt: "2026-08-21T20:55:00.000Z",
    sessionStart: "2026-08-20T22:00:00.000Z",
    sessionEnd: "2026-08-21T21:00:00.000Z",
    sessionStatus: "completed",
    requestedSymbol: "NQ=F",
    returnedSymbol: "NQ=F",
    tier: "nq-local-archive-reference"
  });
  Object.assign(local.provider, {
    localArchive: true,
    sourceFile: "nasdaq_5m.csv",
    sourceSha256: "a".repeat(64)
  });
  local.session.terminalCoverageVerified = true;

  const result = assessSnapshot(local, saturday, currentReference);
  assert.equal(result.usable, false);
  assert.equal(result.displayable, true);
  assert.equal(result.referenceOnly, true);
  assert.equal(result.referenceLineCalculationAllowed, true);
  assert.equal(result.marketState, "local-completed-session");
  assert.match(result.reason, /MNQ가 아니므로/);
});

test("새 주 월요일에도 96시간 이내 로컬 NQ 시가로 상승·하락 참고선을 표시한다", () => {
  const monday = new Date("2026-08-23T16:00:00.000Z");
  const newReference = { effectiveFrom: "2026-08-24", effectiveThrough: "2026-08-30" };
  const local = snapshot({
    mode: "local-archive",
    assessedAt: monday,
    latestAt: "2026-08-21T20:55:00.000Z",
    sessionStart: "2026-08-20T22:00:00.000Z",
    sessionEnd: "2026-08-21T21:00:00.000Z",
    sessionStatus: "completed",
    requestedSymbol: "NQ=F",
    returnedSymbol: "NQ=F",
    tier: "nq-local-archive-reference"
  });
  Object.assign(local.provider, {
    localArchive: true,
    sourceFile: "nasdaq_5m.csv",
    sourceSha256: "c".repeat(64)
  });
  local.session.terminalCoverageVerified = true;

  const result = assessSnapshot(local, monday, newReference);
  assert.equal(result.usable, false);
  assert.equal(result.displayable, true);
  assert.equal(result.referenceOnly, true);
  assert.equal(result.referenceLineCalculationAllowed, true);
  assert.equal(result.referenceValid, true);
  assert.match(result.reason, /가격 원천일 2026-08-22/);
  assert.match(result.reason, /읽기 전용 참고선/);
});

test("주간 기준이 만료돼도 로컬 NQ의 원시 완료 세션 값만 표시한다", () => {
  const saturday = new Date("2026-08-22T12:00:00.000Z");
  const local = snapshot({
    mode: "local-archive",
    assessedAt: saturday,
    latestAt: "2026-08-21T20:55:00.000Z",
    sessionStart: "2026-08-20T22:00:00.000Z",
    sessionEnd: "2026-08-21T21:00:00.000Z",
    sessionStatus: "completed",
    requestedSymbol: "NQ=F",
    returnedSymbol: "NQ=F",
    tier: "nq-local-archive-reference"
  });
  Object.assign(local.provider, {
    localArchive: true,
    sourceFile: "nasdaq_5m.csv",
    sourceSha256: "b".repeat(64)
  });
  local.session.terminalCoverageVerified = true;

  const result = assessSnapshot(local, saturday, reference);
  assert.equal(result.displayable, true);
  assert.equal(result.referenceOnly, true);
  assert.equal(result.referenceLineCalculationAllowed, false);
  assert.match(result.reason, /기준은 .*만료/);
});

test("미래시각·누락시각·비정상 OHLC와 불완전 수동 확인은 fail-close한다", () => {
  assert.equal(assessSnapshot(snapshot({ ageMinutes: -0.001 }), now, reference).usable, false);

  const missingTime = snapshot();
  delete missingTime.market.latestBarAt;
  assert.equal(assessSnapshot(missingTime, now, reference).displayable, false);

  const invalid = snapshot();
  invalid.market.current = 30200;
  assert.equal(assessSnapshot(invalid, now, reference).displayable, false);

  const missingConfirmation = snapshot({ mode: "manual" });
  delete missingConfirmation.provider.actualContractConfirmed;
  assert.equal(assessSnapshot(missingConfirmation, now, reference).displayable, false);

  const mismatchedTime = snapshot({ mode: "manual" });
  mismatchedTime.provider.confirmedAt = new Date(now.getTime() - 11 * 60000).toISOString();
  assert.equal(assessSnapshot(mismatchedTime, now, reference).displayable, false);
});
