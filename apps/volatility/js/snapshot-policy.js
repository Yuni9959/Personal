import { WEEKLY_VOLATILITY_REFERENCE, validateMarketBar } from "./calculator.js";

export const MAX_SOURCE_AGE_MINUTES = 25;
export const MAX_REFERENCE_SOURCE_AGE_MINUTES = 4 * 24 * 60;
export const SESSION_TERMINAL_TOLERANCE_MINUTES = 5;
export const MAX_FUTURE_SKEW_MINUTES = 0;

function decision({
  usable = false,
  displayable = false,
  referenceOnly = false,
  referenceLineCalculationAllowed = false,
  key = "error",
  marketState = "invalid",
  ageMinutes = null,
  reason = "",
  referenceValid = false,
  sessionEndedAt = null
} = {}) {
  return {
    // `usable` is retained for the existing app contract. It is deliberately
    // identical to the stronger trading-calculation permission.
    usable,
    calculationAllowed: usable,
    // `displayable` may be true for a completed-session preview. General stop
    // and live-trading calculations stay locked, while the position panel may
    // use a validated automatic ATR for an explicitly labelled risk review.
    displayable,
    referenceOnly,
    referenceLineCalculationAllowed,
    key,
    marketState,
    ageMinutes,
    reason,
    referenceValid,
    sessionEndedAt
  };
}

export function sourceAgeMinutes(snapshot, now = new Date()) {
  const sourceAt = new Date(snapshot?.market?.latestBarAt || "");
  return Number.isFinite(sourceAt.getTime())
    ? (now.getTime() - sourceAt.getTime()) / 60000
    : null;
}

export function kstDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
}

export function referenceExpiryReason(now = new Date(), reference = WEEKLY_VOLATILITY_REFERENCE) {
  const today = kstDate(now);
  if (today < reference.effectiveFrom) {
    return `주간 Volatility 기준은 ${reference.effectiveFrom}부터 유효해 아직 사용할 수 없습니다.`;
  }
  if (today > reference.effectiveThrough) {
    return `주간 Volatility 기준은 ${reference.effectiveThrough}에 만료되었습니다. 새 기준을 검증·반영하기 전에는 계산을 중지합니다.`;
  }
  return "";
}

function sourceReferenceCoverageReason(snapshot, reference) {
  const sourceAt = new Date(snapshot?.market?.latestBarAt || "");
  if (!Number.isFinite(sourceAt.getTime())) return "가격 원천일을 확인할 수 없습니다.";
  const sourceDate = kstDate(sourceAt);
  if (sourceDate < reference.effectiveFrom) {
    return `가격 원천일 ${sourceDate}은 현재 주간 Volatility 기준 기간보다 이전입니다.`;
  }
  if (sourceDate > reference.effectiveThrough) {
    return `가격 원천일 ${sourceDate}은 현재 주간 Volatility 기준 기간보다 이후입니다.`;
  }
  return "";
}

export function isNqFallback(snapshot) {
  const provider = snapshot?.provider || {};
  const returned = String(provider.returnedSymbol || provider.requestedSymbol || "").toUpperCase();
  return provider.tier === "nq-continuous-fallback-proxy" ||
    provider.fallback === true || returned === "NQ=F";
}

export function isApprovedMnqProxy(snapshot) {
  const provider = snapshot?.provider || {};
  const requested = String(provider.requestedSymbol || "").toUpperCase();
  const returned = String(provider.returnedSymbol || "").toUpperCase();
  const tierMatches = provider.tier === "mnq-continuous-proxy";
  return tierMatches && requested === "MNQ=F" && returned === "MNQ=F";
}

export function isApprovedLocalNqArchive(snapshot) {
  const provider = snapshot?.provider || {};
  return snapshot?.mode === "local-archive" &&
    provider.tier === "nq-local-archive-reference" &&
    provider.localArchive === true &&
    provider.requestedSymbol === "NQ=F" && provider.returnedSymbol === "NQ=F" &&
    provider.sourceFile === "nasdaq_5m.csv" &&
    /^[a-f0-9]{64}$/.test(String(provider.sourceSha256 || ""));
}

function manualConfirmationValid(snapshot) {
  const provider = snapshot?.provider || {};
  const confirmedAt = new Date(provider.confirmedAt || "");
  const sourceAt = new Date(snapshot?.market?.latestBarAt || "");
  return provider.actualContractConfirmed === true &&
    Number.isFinite(confirmedAt.getTime()) &&
    confirmedAt.getTime() === sourceAt.getTime();
}

function validatedProviderSession(snapshot, now) {
  const session = snapshot?.session || {};
  const start = new Date(session.start || "");
  const end = new Date(session.end || "");
  // v3.3 cached snapshots predate session.lastObservedAt.  Their already
  // validated provider.sourceEventAt is accepted only when the new field is
  // genuinely absent; a present-but-conflicting field must fail closed.
  const observedSource = Object.hasOwn(session, "lastObservedAt")
    ? session.lastObservedAt
    : snapshot?.provider?.sourceEventAt;
  const lastObservedAt = new Date(observedSource || "");
  const sourceAt = new Date(snapshot?.market?.latestBarAt || "");
  if (![start, end, lastObservedAt, sourceAt].every(value => Number.isFinite(value.getTime())) ||
      start.getTime() >= end.getTime() ||
      sourceAt.getTime() !== lastObservedAt.getTime() ||
      sourceAt.getTime() < start.getTime() || sourceAt.getTime() >= end.getTime()) {
    return null;
  }

  const terminalToleranceMs = SESSION_TERMINAL_TOLERANCE_MINUTES * 60000;
  return {
    start,
    end,
    ended: now.getTime() >= end.getTime(),
    terminalCoverageVerified: sourceAt.getTime() >= end.getTime() - terminalToleranceMs
  };
}

export function assessSnapshot(snapshot, now = new Date(), reference = WEEKLY_VOLATILITY_REFERENCE) {
  const validation = validateMarketBar(snapshot?.market);
  if (!validation.valid) {
    return decision({ reason: "가격 검증에 실패한 데이터입니다." });
  }

  const ageMinutes = sourceAgeMinutes(snapshot, now);
  if (ageMinutes === null) {
    return decision({ ageMinutes, reason: "제공된 가격시각을 확인할 수 없습니다." });
  }
  if (ageMinutes < -MAX_FUTURE_SKEW_MINUTES) {
    return decision({ ageMinutes, reason: "제공된 가격시각이 현재보다 미래여서 사용할 수 없습니다." });
  }

  const expiredReference = referenceExpiryReason(now, reference);
  const sourceReferenceMismatch = sourceReferenceCoverageReason(snapshot, reference);
  // A current weekly contract may be converted from a recent completed
  // session's open even when that source session belongs to the prior week.
  // This remains a read-only reference line; live, position, ATR and stop
  // calculations stay locked. Only an expired weekly contract blocks it.
  const referenceValid = expiredReference === "";

  if (snapshot?.mode === "manual") {
    if (!manualConfirmationValid(snapshot)) {
      return decision({
        ageMinutes,
        referenceValid,
        reason: "실제 MNQ 월물을 방금 직접 확인했다는 확인 기록이 없어 수동 계산을 중지합니다."
      });
    }
    if (ageMinutes > MAX_SOURCE_AGE_MINUTES) {
      return decision({
        key: "stale",
        marketState: "manual-stale",
        ageMinutes,
        referenceValid,
        reason: `수동 확인값은 ${Math.round(ageMinutes)}분 전 값이어서 자동 계산을 중지했습니다.`
      });
    }
    if (!referenceValid) {
      return decision({
        marketState: "reference-expired",
        ageMinutes,
        referenceValid,
        reason: expiredReference
      });
    }
    return decision({
      usable: true,
      displayable: true,
      referenceLineCalculationAllowed: true,
      key: "manual",
      marketState: "active-manual",
      ageMinutes: Math.max(0, ageMinutes),
      referenceValid: true
    });
  }

  if (isApprovedLocalNqArchive(snapshot)) {
    const providerSession = validatedProviderSession(snapshot, now);
    if (!providerSession || !providerSession.ended || !providerSession.terminalCoverageVerified) {
      return decision({
        ageMinutes,
        referenceValid,
        reason: "로컬 NQ 보관값의 완료 세션 경계와 마지막 관측시각을 검증할 수 없습니다."
      });
    }
    if (ageMinutes > MAX_REFERENCE_SOURCE_AGE_MINUTES) {
      return decision({
        key: "stale",
        marketState: "reference-expired",
        ageMinutes,
        referenceValid,
        sessionEndedAt: providerSession.end.toISOString(),
        reason: `로컬 NQ 보관값이 ${Math.round(ageMinutes)}분 전이어서 최근 완료 세션 참고 범위를 벗어났습니다.`
      });
    }
    return decision({
      displayable: true,
      referenceOnly: true,
      referenceLineCalculationAllowed: referenceValid,
      key: "reference",
      marketState: "local-completed-session",
      ageMinutes: Math.max(0, ageMinutes),
      referenceValid,
      sessionEndedAt: providerSession.end.toISOString(),
      reason: !referenceValid
        ? `사용자가 동기화한 최근 완료 NQ 세션의 O/H/L/마지막 관측가만 표시합니다. ${expiredReference}`
        : sourceReferenceMismatch
          ? `사용자가 동기화한 최근 완료 NQ 세션의 참고값입니다. ${sourceReferenceMismatch} 현재 주간 기준을 최근 세션 시가에 환산한 읽기 전용 참고선이며, MNQ가 아니므로 자동 ATR 포지션 위험 복기 외의 손절·실전 계산에는 사용하지 않습니다.`
          : "사용자가 동기화한 최근 완료 NQ 세션의 참고값입니다. MNQ가 아니므로 자동 ATR 포지션 위험 복기 외의 손절·실전 계산에는 사용하지 않습니다."
    });
  }

  if (isNqFallback(snapshot)) {
    return decision({
      key: "stale",
      ageMinutes,
      referenceValid,
      reason: "NQ 대체 연속선물은 MNQ가 아니므로 자동 계산이나 이전값 미리보기에 사용하지 않습니다."
    });
  }
  if (!isApprovedMnqProxy(snapshot)) {
    return decision({
      ageMinutes,
      referenceValid,
      reason: "MNQ=F로 검증되지 않은 종목·출처 응답이어서 계산과 이전값 미리보기를 중지합니다."
    });
  }

  const providerSession = validatedProviderSession(snapshot, now);
  if (!providerSession) {
    return decision({
      ageMinutes,
      referenceValid,
      reason: "MNQ 세션 경계와 마지막 관측시각을 검증할 수 없어 계산과 이전값 미리보기를 중지합니다."
    });
  }

  if (!referenceValid) {
    return decision({
      marketState: "reference-expired",
      ageMinutes,
      referenceValid,
      sessionEndedAt: providerSession.end.toISOString(),
      reason: expiredReference
    });
  }

  if (ageMinutes > MAX_REFERENCE_SOURCE_AGE_MINUTES) {
    return decision({
      key: "stale",
      marketState: "reference-expired",
      ageMinutes,
      referenceValid: true,
      sessionEndedAt: providerSession.end.toISOString(),
      reason: `마지막 MNQ 관측값이 ${Math.round(ageMinutes)}분 전이어서 최근 완료 세션 참고 범위를 벗어났습니다.`
    });
  }

  if (providerSession.ended) {
    if (!providerSession.terminalCoverageVerified) {
      return decision({
        key: "stale",
        marketState: "ended-incomplete",
        ageMinutes,
        referenceValid: true,
        sessionEndedAt: providerSession.end.toISOString(),
        reason: "종료된 MNQ 세션의 마지막 5분 구간이 확인되지 않아 이전값 미리보기를 중지합니다."
      });
    }
    return decision({
      displayable: true,
      referenceOnly: true,
      referenceLineCalculationAllowed: true,
      key: "reference",
      marketState: "completed-session",
      ageMinutes: Math.max(0, ageMinutes),
      referenceValid: true,
      sessionEndedAt: providerSession.end.toISOString(),
      reason: sourceReferenceMismatch
        ? `최근 완료된 MNQ 세션의 참고값입니다. ${sourceReferenceMismatch} 현재 주간 기준을 최근 세션 시가에 환산한 읽기 전용 참고선이며, 자동 ATR 포지션 위험 복기 외의 손절·실전 계산에는 사용하지 않습니다.`
        : "최근 완료된 MNQ 세션의 참고값입니다. 현재 시세가 아니며 자동 ATR 포지션 위험 복기 외의 손절·실전 계산에는 사용하지 않습니다."
    });
  }

  const leadingMissingBucketCount = Number(snapshot?.provider?.leadingMissingBucketCount || 0);
  if (leadingMissingBucketCount > 0 &&
      snapshot?.provider?.regularMarketOpenMetadataAvailable !== true &&
      ageMinutes <= MAX_SOURCE_AGE_MINUTES) {
    return decision({
      displayable: true,
      referenceOnly: true,
      key: "reference",
      marketState: "active-partial-open",
      ageMinutes: Math.max(0, ageMinutes),
      referenceValid: true,
      sessionEndedAt: providerSession.end.toISOString(),
      reason: `진행 중인 MNQ의 최신값이지만 세션 시작 ${leadingMissingBucketCount}개 봉과 공식 시가가 없어 시가 기반 계산은 잠급니다. 현재가·자동 차트 지표·포지션 위험 판정만 참고하세요.`
    });
  }

  if (ageMinutes > MAX_SOURCE_AGE_MINUTES) {
    return decision({
      key: "stale",
      marketState: "active-stale",
      ageMinutes,
      referenceValid: true,
      sessionEndedAt: providerSession.end.toISOString(),
      reason: `진행 중인 MNQ 세션의 가격이 ${Math.round(ageMinutes)}분 전 값이어서 계산과 완료 세션 미리보기를 중지했습니다.`
    });
  }

  return decision({
    usable: true,
    displayable: true,
    referenceLineCalculationAllowed: true,
    key: "delayed",
    marketState: "active",
    ageMinutes: Math.max(0, ageMinutes),
    referenceValid: true,
    sessionEndedAt: providerSession.end.toISOString()
  });
}

export function selectBestSnapshotCandidate(candidates, now = new Date(), reference = WEEKLY_VOLATILITY_REFERENCE) {
  if (!Array.isArray(candidates)) throw new TypeError("시세 후보 배열이 필요합니다.");
  return candidates.map((candidate, index) => ({
    ...candidate,
    index,
    assessment: assessSnapshot(candidate?.snapshot, now, reference),
    sourceTime: new Date(candidate?.snapshot?.market?.latestBarAt || "").getTime()
  })).filter(candidate => candidate.assessment.displayable && Number.isFinite(candidate.sourceTime))
    .sort((left, right) =>
      right.sourceTime - left.sourceTime ||
      Number(right.assessment.usable) - Number(left.assessment.usable) ||
      left.index - right.index
    )[0] || null;
}
