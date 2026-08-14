import { WEEKLY_VOLATILITY_REFERENCE, validateMarketBar } from "./calculator.js";

export const MAX_SOURCE_AGE_MINUTES = 25;
export const MAX_FUTURE_SKEW_MINUTES = 0;

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
    return `주간 Volatility 기준이 ${reference.effectiveFrom}부터 유효해 아직 사용할 수 없습니다.`;
  }
  if (today > reference.effectiveThrough) {
    return `주간 Volatility 기준이 ${reference.effectiveThrough}에 만료됐습니다. 새 기준을 검증·배포하기 전 계산을 중지합니다.`;
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

export function assessSnapshot(snapshot, now = new Date(), reference = WEEKLY_VOLATILITY_REFERENCE) {
  const validation = validateMarketBar(snapshot?.market);
  if (!validation.valid) {
    return { usable: false, key: "error", ageMinutes: null, reason: "가격 검증에 실패한 데이터입니다." };
  }

  const ageMinutes = sourceAgeMinutes(snapshot, now);
  if (ageMinutes === null) {
    return { usable: false, key: "error", ageMinutes, reason: "제공자 가격시각을 확인할 수 없습니다." };
  }
  if (ageMinutes < -MAX_FUTURE_SKEW_MINUTES) {
    return { usable: false, key: "error", ageMinutes, reason: "제공자 가격시각이 현재보다 미래여서 사용할 수 없습니다." };
  }
  if (ageMinutes > MAX_SOURCE_AGE_MINUTES) {
    const source = snapshot?.mode === "manual" ? "수동 확인값" : "제공자 가격";
    return {
      usable: false,
      key: "stale",
      ageMinutes,
      reason: `${source}이 ${Math.round(ageMinutes)}분 전 값이라 자동 계산을 중지했습니다.`
    };
  }

  const expiredReference = referenceExpiryReason(now, reference);
  if (expiredReference) {
    return { usable: false, key: "error", ageMinutes, reason: expiredReference };
  }
  if (snapshot?.mode === "manual") {
    const provider = snapshot?.provider || {};
    const confirmedAt = new Date(provider.confirmedAt || "");
    const sourceAt = new Date(snapshot?.market?.latestBarAt || "");
    if (provider.actualContractConfirmed !== true ||
        !Number.isFinite(confirmedAt.getTime()) ||
        confirmedAt.getTime() !== sourceAt.getTime()) {
      return {
        usable: false,
        key: "error",
        ageMinutes,
        reason: "실제 MNQ 월물을 방금 직접 확인했다는 확인 기록이 없어 수동 계산을 중지했습니다."
      };
    }
    return { usable: true, key: "manual", ageMinutes: Math.max(0, ageMinutes), reason: "" };
  }
  if (isNqFallback(snapshot)) {
    return {
      usable: false,
      key: "stale",
      ageMinutes,
      reason: "NQ 대체 프록시는 MNQ가 아니므로 자동 계산에 사용하지 않습니다. 실제 MNQ 값을 수동 입력하세요."
    };
  }
  if (!isApprovedMnqProxy(snapshot)) {
    return {
      usable: false,
      key: "error",
      ageMinutes,
      reason: "MNQ=F로 검증되지 않은 종목·출처 식별값이어서 자동 계산을 중지했습니다."
    };
  }
  return { usable: true, key: "delayed", ageMinutes: Math.max(0, ageMinutes), reason: "" };
}
