import {
  TAIL_LOSS_AVOIDANCE_EVIDENCE,
  WEEKLY_VOLATILITY_REFERENCE as REFERENCE,
  assessPositionLossRisk,
  assessTailLossAvoidance,
  calculatePositionPathFeatures,
  calculateSafeReachScenario,
  calculateVolatilityScenario,
  classifyLiveTradePattern,
  classifyPatternRisk,
  validateMarketBar
} from "./calculator.js";
import { fetchYahooSnapshot } from "./market-provider.js";
import {
  fetchLocalNasdaqSnapshot,
  shouldPreferLocalArchive
} from "./local-market-provider.js";
import {
  REQUEST_COOLDOWN_MS,
  REQUEST_DEADLINE_MS,
  calculateRateLimitBackoff,
  calculateCooldown,
  rateLimitUntilFromMetadata,
  withExclusiveRequest
} from "./request-guard.js";
import {
  MAX_SOURCE_AGE_MINUTES,
  assessSnapshot,
  isNqFallback,
  selectBestSnapshotCandidate,
  sourceAgeMinutes
} from "./snapshot-policy.js";

const SNAPSHOT_CACHE_KEY = "personal-tap-volatility-snapshot-v1";
const LAST_REQUEST_KEY = "personal-tap-volatility-last-request-v1";
const RATE_LIMIT_UNTIL_KEY = "personal-tap-volatility-rate-limit-until-v1";
const LEGACY_MANUAL_KEY = "personal-tap-volatility-manual-v1";
const POSITION_KEY = "personal-tap-volatility-position-v1";

const $ = selector => document.querySelector(selector);
const els = {
  dataStatus: $("#dataStatus"), dataNotice: $("#dataNotice"), refreshBtn: $("#refreshBtn"),
  marketTitle: $("#marketTitle"), quoteGrid: $("#quoteGrid"),
  manualToggleBtn: $("#manualToggleBtn"), manualPanel: $("#manualPanel"), manualError: $("#manualError"),
  openPrice: $("#openPrice"), highPrice: $("#highPrice"), lowPrice: $("#lowPrice"),
  currentPriceLabel: $("#currentPriceLabel"), currentPrice: $("#currentPrice"),
  atrValue: $("#atrValue"), symbolLabel: $("#symbolLabel"),
  barUpdateText: $("#barUpdateText"), lastUpdateText: $("#lastUpdateText"), delayText: $("#delayText"),
  automaticCalculations: $("#automaticCalculations"), calculationLock: $("#calculationLock"),
  bullMeanReference: $("#bullMeanReference"), bullSafeReference: $("#bullSafeReference"),
  bearMeanReference: $("#bearMeanReference"), bearSafeReference: $("#bearSafeReference"),
  bullLiveLabel: $("#bullLiveLabel"), bearLiveLabel: $("#bearLiveLabel"),
  bullReferenceConditionalLabel: $("#bullReferenceConditionalLabel"),
  bearReferenceConditionalLabel: $("#bearReferenceConditionalLabel"),
  bullConditionalLabel: $("#bullConditionalLabel"), bearConditionalLabel: $("#bearConditionalLabel"),
  bullConditionalReference: $("#bullConditionalReference"), bearConditionalReference: $("#bearConditionalReference"),
  referenceOpenLabel: $("#referenceOpenLabel"), referenceOpenPrice: $("#referenceOpenPrice"),
  referenceOpenContext: $("#referenceOpenContext"), referencePeriod: $("#referencePeriod"),
  bullMeanMove: $("#bullMeanMove"), bullMeanPrice: $("#bullMeanPrice"),
  bearMeanMove: $("#bearMeanMove"), bearMeanPrice: $("#bearMeanPrice"),
  bullLiveMove: $("#bullLiveMove"), bullLivePrice: $("#bullLivePrice"),
  bearLiveMove: $("#bearLiveMove"), bearLivePrice: $("#bearLivePrice"),
  bullConditionalMove: $("#bullConditionalMove"), bullConditionalPrice: $("#bullConditionalPrice"),
  bearConditionalMove: $("#bearConditionalMove"), bearConditionalPrice: $("#bearConditionalPrice"),
  operationalUpPercent: $("#operationalUpPercent"), operationalDownPercent: $("#operationalDownPercent"),
  operationalUpLabel: $("#operationalUpLabel"), operationalDownLabel: $("#operationalDownLabel"),
  operationalUpLine: $("#operationalUpLine"), operationalDownLine: $("#operationalDownLine"),
  operationalUpState: $("#operationalUpState"), operationalDownState: $("#operationalDownState"),
  operationalUpHitRate: $("#operationalUpHitRate"), operationalDownHitRate: $("#operationalDownHitRate"),
  manualOpen: $("#manualOpen"), manualHigh: $("#manualHigh"), manualLow: $("#manualLow"),
  manualCurrent: $("#manualCurrent"), manualAtr: $("#manualAtr"), manualConfirm: $("#manualConfirm"),
  useAutoAtrBtn: $("#useAutoAtrBtn"),
  positionForm: $("#positionForm"), positionDirection: $("#positionDirection"), entryPrice: $("#entryPrice"),
  enteredAt: $("#enteredAt"), currentQuantity: $("#currentQuantity"),
  maxQuantity: $("#maxQuantity"), addCount: $("#addCount"),
  positionEmpty: $("#positionEmpty"), positionResults: $("#positionResults"),
  positionSummary: $("#positionSummary"), positionMarketNote: $("#positionMarketNote"),
  positionRiskPanel: $("#positionRiskPanel"), positionRiskHeadline: $("#positionRiskHeadline"),
  positionRiskSummary: $("#positionRiskSummary"), positionRiskMetrics: $("#positionRiskMetrics"),
  positionRiskChecklist: $("#positionRiskChecklist"),
  patternEmpty: $("#patternEmpty"), patternResults: $("#patternResults"),
  patternHeadline: $("#patternHeadline"), patternSummary: $("#patternSummary"),
  patternEvidence: $("#patternEvidence"), patternIndicators: $("#patternIndicators"),
  p6Result: $("#p6Result"), killResult: $("#killResult"), p7Result: $("#p7Result")
};

const scenarioEls = {
  bull: {
    meanPercent: $("#bullMeanPercent"), safePercent: $("#bullSafePercent"),
    budget: $("#bullBudget"), rangeState: $("#bullRangeState"), safeMove: $("#bullSafeMove"),
    safeLine: $("#bullSafeLine"), safeStatus: $("#bullSafeStatus"), hitRate: $("#bullHitRate"),
    progress: $("#bullProgress")
  },
  bear: {
    meanPercent: $("#bearMeanPercent"), safePercent: $("#bearSafePercent"),
    budget: $("#bearBudget"), rangeState: $("#bearRangeState"), safeMove: $("#bearSafeMove"),
    safeLine: $("#bearSafeLine"), safeStatus: $("#bearSafeStatus"), hitRate: $("#bearHitRate"),
    progress: $("#bearProgress")
  }
};

const state = {
  snapshot: null,
  chartSnapshot: null,
  assessment: null,
  scenarios: null,
  operational: null,
  autoAtr: null,
  calculationAllowed: false,
  lastRequestAt: 0,
  rateLimitUntil: 0,
  forceLockReason: "",
  expiryTimer: null,
  transientNotice: ""
};
const POSITION_EMPTY_MESSAGE = "방향·체결가격·체결시간을 입력하면 현재가와 자동 5분 ATR로 대손실 회피 체크리스트를 점검합니다.";
const numberFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kstFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
});
const kstCompactFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
});

function readJson(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* Private mode can reject storage; calculations still work. */ }
}

function formatNumber(value, suffix = "") {
  return isFiniteValue(value) ? `${numberFormat.format(Number(value))}${suffix}` : "—";
}

function isFiniteValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function formatDate(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? `${kstFormat.format(date)} KST` : "—";
}

function formatCompactDate(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? `${kstCompactFormat.format(date)} KST` : "시각 미확인";
}

function marketFromSnapshot(snapshot) {
  return snapshot?.market || null;
}

function validateSnapshot(snapshot) {
  const validation = validateMarketBar(marketFromSnapshot(snapshot));
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  return snapshot;
}

function providerDescription(snapshot) {
  if (snapshot?.mode === "manual") return "MNQ · 사용자 수동 확인";
  const provider = snapshot?.provider || {};
  const symbol = String(provider.returnedSymbol || provider.requestedSymbol || "종목 미확인");
  if (snapshot?.mode === "local-archive") return `${symbol} · 사용자 동기화 로컬 보관 참고값 (MNQ 아님)`;
  if (isNqFallback(snapshot)) return `${symbol} · NQ 연속선물 대체 프록시 (MNQ 아님)`;
  if (symbol.toUpperCase() === "MNQ=F") return `${symbol} · MNQ 연속선물 프록시`;
  return `${symbol} · Yahoo 지연 참고시세`;
}

function delayDescription(snapshot, assessment) {
  if (snapshot?.mode === "manual" && assessment.usable) {
    return `사용자 직접 확인 · ${Math.max(0, Math.round(assessment.ageMinutes))}분 전 입력`;
  }
  if (assessment.ageMinutes === null) return "시각 확인 불가 · 계산 중지";
  const age = `${Math.max(0, Math.round(assessment.ageMinutes))}분 전 가격`;
  if (assessment.referenceOnly) {
    const referenceLabel = assessment.marketState === "active-partial-open"
      ? "최신 Yahoo 시세 참고"
      : ["completed-session", "local-completed-session"].includes(assessment.marketState)
        ? "최근 완료 세션 참고"
        : "이전 검증 시세 참고";
    return `${age} · ${referenceLabel} · 실전 계산 잠금`;
  }
  const delayLabel = snapshot?.provider?.delayMetadataVerified === false
    ? "지연시간 메타 없음 · 원천시각 기준"
    : "약 10분 지연 참고";
  return assessment.usable ? `${age} · ${delayLabel}` : `${age} · 계산 중지`;
}

function setCompactDataStatus(key, text) {
  els.dataStatus.dataset.state = key;
  els.dataStatus.textContent = text;
}

function setRefreshBusy(busy) {
  els.refreshBtn.disabled = busy;
  els.refreshBtn.setAttribute("aria-busy", String(busy));
}

function barQualityNotice(snapshot, assessment) {
  const provider = snapshot?.provider || {};
  const missingCount = Number(provider.missingInteriorBucketCount || 0);
  if (assessment.displayable && snapshot?.mode === "local-archive" && missingCount === 1) {
    return "로컬 보관 5분봉 1개 결손 이후 연속 완료봉으로 ATR과 차트 지표를 다시 계산했습니다.";
  }
  if (assessment.displayable && provider.barQuality === "leading-null-buckets") {
    return `세션 시작 ${Number(provider.leadingMissingBucketCount || 0)}개 봉이 없어 첫 관측 기준가는 주간 표 환산에만 사용하며, 최신 현재가·EMA·RSI·ATR은 완료봉으로 자동 계산했습니다.`;
  }
  if (!assessment.displayable || snapshot?.mode === "manual" ||
      provider.barQuality !== "one-interior-null-bucket" || missingCount !== 1) return "";
  return provider.regularMarketOpenMetadataAvailable
    ? "5분봉 1개 결손 · 일중 O/H/L/현재가·시각은 공급자 메타와 교차검증 · ATR은 결손 이후 연속 완료봉으로 재계산"
    : "5분봉 1개 결손 · H/L/현재가·시각은 공급자 메타와 교차검증, 시가는 첫 세션봉 기준 · ATR은 결손 이후 연속 완료봉으로 재계산";
}

function setStatus(snapshot, assessment = assessSnapshot(snapshot)) {
  const isActiveManual = snapshot?.mode === "manual" && assessment.usable;
  const ageMinutes = assessment.ageMinutes === null
    ? null
    : Math.max(0, Math.round(assessment.ageMinutes));
  if (isActiveManual) setCompactDataStatus("manual", "수동 입력");
  else if (assessment.usable) setCompactDataStatus("delayed", "시세 사용 가능");
  else if (assessment.referenceOnly) {
    setCompactDataStatus("aging", assessment.marketState === "active-partial-open"
      ? "최신 시세 참고"
      : assessment.marketState === "completed-session" ? "최근 세션 참고" : "이전 시세 참고");
  }
  else if (assessment.key === "stale") setCompactDataStatus("stale", "시세 만료");
  else setCompactDataStatus("error", "시세 없음");
  els.dataNotice.className = "notice";
  if (isActiveManual) {
    els.dataNotice.textContent = "수동 입력값으로 계산 중입니다. 주문 전 실제 월물 시세와 다시 대조하세요.";
  } else if (assessment.referenceOnly) {
    els.dataNotice.classList.add("warning");
    const sourceLabel = assessment.marketState === "active-partial-open"
      ? "최신 Yahoo 관측"
      : ["completed-session", "local-completed-session"].includes(assessment.marketState)
        ? "최근 완료 세션"
        : "이전에 검증한 세션";
    const referenceDetail = assessment.referenceLineCalculationAllowed
      ? "이번 주 기준 환산선도 함께 표시하지만"
      : "주간 기준 환산선은 잠그고";
    els.dataNotice.textContent = `${assessment.reason} ${sourceLabel}의 O/H/L/마지막 관측가와 자동 ATR 위험 판정은 참고값으로 열고 ${referenceDetail} 손절·실전 계산은 잠급니다.`;
  } else if (!assessment.usable) {
    els.dataNotice.classList.add(assessment.key === "error" ? "error" : "warning");
    const ageDetail = ageMinutes === null ? "" : ` 마지막 참고 가격은 ${ageMinutes}분 전 값입니다.`;
    els.dataNotice.textContent = `${assessment.reason}${ageDetail} 현재 시세 숫자는 숨겼으며 이전값을 시나리오·포지션 계산에 사용하지 않습니다.`;
  } else {
    const delayLabel = snapshot?.provider?.delayMetadataVerified === false
      ? "지연시간 메타가 없어 원천 관측시각으로만 신규도를 판정한"
      : "약 10분 지연";
    els.dataNotice.textContent = `사용자가 요청할 때만 조회한 Yahoo ${delayLabel} MNQ 연속선물 프록시입니다. 실제 월물·증권사 시세와 확인한 후에만 사용하세요.`;
  }
  const qualityNotice = barQualityNotice(snapshot, assessment);
  if (qualityNotice) els.dataNotice.textContent += ` ${qualityNotice}`;
  if (state.transientNotice) els.dataNotice.textContent += ` ${state.transientNotice}`;
}

function formatPercent(value, digits = 3) {
  return value !== null && value !== "" && Number.isFinite(Number(value))
    ? `${Number(value).toFixed(digits)}%`
    : "—";
}

const referencePriceRows = Object.freeze([
  Object.freeze({
    direction: "bull", percent: () => REFERENCE.directions.bull.rangeMeanPercent,
    move: () => els.bullMeanMove, price: () => els.bullMeanPrice
  }),
  Object.freeze({
    direction: "bear", percent: () => REFERENCE.directions.bear.rangeMeanPercent,
    move: () => els.bearMeanMove, price: () => els.bearMeanPrice
  }),
  Object.freeze({
    direction: "bull", percent: () => REFERENCE.exAnte.up.safePercent,
    move: () => els.bullLiveMove, price: () => els.bullLivePrice
  }),
  Object.freeze({
    direction: "bear", percent: () => REFERENCE.exAnte.down.safePercent,
    move: () => els.bearLiveMove, price: () => els.bearLivePrice
  }),
  Object.freeze({
    direction: "bull", percent: () => REFERENCE.directions.bull.safePercent,
    move: () => els.bullConditionalMove, price: () => els.bullConditionalPrice
  }),
  Object.freeze({
    direction: "bear", percent: () => REFERENCE.directions.bear.safePercent,
    move: () => els.bearConditionalMove, price: () => els.bearConditionalPrice
  })
]);

function renderReferenceContext(snapshot = null, assessment = null) {
  if (!snapshot || !assessment?.displayable) {
    els.referenceOpenLabel.textContent = "오늘 시가";
    els.referenceOpenContext.textContent = "검증된 시세 대기";
    return;
  }
  if (assessment.marketState === "active-partial-open") {
    const explicitAt = new Date(snapshot.provider?.firstObservedBarAt || "");
    const sessionStart = new Date(snapshot.session?.start || "");
    const inferredAt = new Date(sessionStart.getTime() +
      Number(snapshot.provider?.leadingMissingBucketCount || 0) * 5 * 60000);
    const firstObservedAt = Number.isFinite(explicitAt.getTime()) ? explicitAt : inferredAt;
    els.referenceOpenLabel.textContent = "첫 관측 기준가";
    els.referenceOpenContext.textContent = `${formatCompactDate(firstObservedAt)} · 공식 시가 아님`;
    return;
  }
  if (assessment.referenceOnly) {
    els.referenceOpenLabel.textContent = "최근 기준 시가";
    els.referenceOpenContext.textContent = `${formatCompactDate(snapshot.market?.latestBarAt)} 기준`;
    return;
  }
  els.referenceOpenLabel.textContent = snapshot.mode === "manual" ? "확인 시가" : "오늘 시가";
  els.referenceOpenContext.textContent = snapshot.mode === "manual"
    ? "사용자 직접 확인값"
    : "검증된 진행 세션";
}

function renderReferencePrices(market = null) {
  if (!market) {
    els.referenceOpenPrice.textContent = "—";
    for (const row of referencePriceRows) {
      row.move().textContent = "—";
      row.price().textContent = "—";
    }
    return;
  }

  els.referenceOpenPrice.textContent = formatNumber(market.open);
  for (const row of referencePriceRows) {
    const scenario = calculateSafeReachScenario(market, row.direction, row.percent());
    const sign = row.direction === "bull" ? "+" : "−";
    row.move().textContent = `${sign}${formatNumber(scenario.movePoints, " pt")}`;
    row.price().textContent = formatNumber(scenario.priceLine);
  }
}

function renderScenario(kind, average, safe, reference, current) {
  const target = scenarioEls[kind];
  target.meanPercent.textContent = formatPercent(reference.rangeMeanPercent);
  target.safePercent.textContent = formatPercent(reference.safePercent);
  target.budget.textContent = formatNumber(average.budgetPoints, " pt");
  const remaining = average.exhausted ? "0.00 pt · 평균 초과" : formatNumber(average.remainingPoints, " pt 잔여");
  target.rangeState.textContent = `${formatNumber(average.usedPoints, " pt")} / ${remaining}`;

  if (!safe) {
    target.safeMove.textContent = "분석 확정 대기";
    target.safeLine.textContent = "—";
    target.safeStatus.textContent = "—";
    target.hitRate.textContent = "—";
    target.progress.style.width = "0%";
    target.progress.parentElement.title = "안전측 분석값이 아직 없습니다.";
    return;
  }

  const sign = kind === "bull" ? "+" : "−";
  const joiner = kind === "bull" ? "+" : "−";
  target.safeMove.textContent = `${sign}${formatNumber(safe.movePoints, " pt")}`;
  target.safeLine.textContent = `${formatNumber(state.snapshot.market.open)} ${joiner} ${formatNumber(safe.movePoints)} = ${formatNumber(safe.priceLine)}`;
  target.safeStatus.textContent = safe.reached
    ? `오늘 도달 · ${kind === "bull" ? "고가" : "저가"} 기준`
    : `현재가에서 ${formatNumber(safe.remainingFromCurrent, " pt")} 남음`;
  const confidence = Number.isFinite(Number(reference.walkForwardWilson95Low)) &&
    Number.isFinite(Number(reference.walkForwardWilson95High))
    ? ` · 95% CI ${formatPercent(reference.walkForwardWilson95Low, 1)}–${formatPercent(reference.walkForwardWilson95High, 1)}`
    : "";
  target.hitRate.textContent = `${formatPercent(reference.walkForwardHitRate, 1)}${confidence}`;
  target.progress.style.width = `${Math.min(100, Math.max(0, safe.progressPercent))}%`;
  target.progress.parentElement.title = `안전측 선 도달 진행 ${formatNumber(safe.progressPercent, "%")} · 현재가 ${formatNumber(current)}`;
}

function renderOperational(kind, scenario, reference) {
  const up = kind === "up";
  const percentElement = up ? els.operationalUpPercent : els.operationalDownPercent;
  const lineElement = up ? els.operationalUpLine : els.operationalDownLine;
  const stateElement = up ? els.operationalUpState : els.operationalDownState;
  const hitElement = up ? els.operationalUpHitRate : els.operationalDownHitRate;
  const sign = up ? "+" : "−";

  percentElement.textContent = formatPercent(reference.safePercent);
  lineElement.textContent = `${formatNumber(state.snapshot.market.open)} ${sign} ${formatNumber(scenario.movePoints, " pt")} = ${formatNumber(scenario.priceLine)}`;
  stateElement.textContent = scenario.reached
    ? `오늘 ${up ? "고가" : "저가"}가 이미 도달`
    : `현재가에서 ${formatNumber(scenario.remainingFromCurrent, " pt")} 남음`;
  hitElement.textContent = `최근 52주 OOS ${formatPercent(reference.walkForwardHitRate, 1)} · 95% CI ${formatPercent(reference.walkForwardWilson95Low, 1)}–${formatPercent(reference.walkForwardWilson95High, 1)} · n=${reference.walkForwardSampleCount}`;
}

function setCalculationLock(locked, reason = "") {
  els.automaticCalculations.hidden = locked;
  els.calculationLock.hidden = !locked;
  els.calculationLock.textContent = locked
    ? `${reason || "검증된 MNQ 시세가 없습니다."} 실제 MNQ O/H/L/현재가를 확인해 수동 입력하면 계산이 다시 열립니다.`
    : "";
}

function clearExpiryTimer() {
  if (state.expiryTimer !== null) window.clearTimeout(state.expiryTimer);
  state.expiryTimer = null;
}

function scheduleExpiryCheck() {
  clearExpiryTimer();
  if (!state.snapshot || !state.assessment?.displayable) return;
  if (state.assessment.referenceOnly) {
    // A completed-session preview must close at the 96-hour or weekly-reference
    // boundary even when the tab remains open and receives no focus event.
    state.expiryTimer = window.setTimeout(() => {
      state.expiryTimer = null;
      renderMarket();
    }, 60_000);
    return;
  }
  const ageMinutes = sourceAgeMinutes(state.snapshot);
  if (ageMinutes === null) return;
  const remainingMs = Math.max(0, (MAX_SOURCE_AGE_MINUTES - ageMinutes) * 60000);
  state.expiryTimer = window.setTimeout(() => {
    state.expiryTimer = null;
    renderMarket();
  }, Math.min(remainingMs + 100, 60_000));
}

function renderMarket() {
  if (!state.snapshot) return;
  const market = state.snapshot.market;
  const currentAssessment = assessSnapshot(state.snapshot);
  const assessment = state.forceLockReason
    ? {
        ...currentAssessment,
        usable: false,
        calculationAllowed: false,
        displayable: currentAssessment.displayable,
        referenceOnly: currentAssessment.displayable,
        key: currentAssessment.displayable ? "reference" : "stale",
        reason: state.forceLockReason
      }
    : currentAssessment;
  state.assessment = assessment;
  state.calculationAllowed = assessment.calculationAllowed === true;
  const displayable = assessment.displayable === true;
  const referenceVisible = displayable && assessment.referenceLineCalculationAllowed === true;
  setStatus(state.snapshot, assessment);
  renderReferenceContext(state.snapshot, assessment);
  renderReferencePrices(referenceVisible ? market : null);
  const completedSessionPreview = assessment.referenceOnly &&
    ["completed-session", "local-completed-session"].includes(assessment.marketState);
  const latestPartialPreview = assessment.marketState === "active-partial-open";
  els.marketTitle.textContent = assessment.referenceOnly
    ? (latestPartialPreview ? "오늘의 최신 시세" : completedSessionPreview ? "최근 완료 세션" : "이전 참고 시세")
    : "오늘의 시세";
  const displayedSymbol = state.snapshot.mode === "local-archive" ? "NQ" : "MNQ";
  els.quoteGrid.setAttribute("aria-label", assessment.referenceOnly
    ? (latestPartialPreview ? `${displayedSymbol} 오늘 최신 참고 시세` : completedSessionPreview ? `${displayedSymbol} 최근 완료 세션 참고 시세` : `${displayedSymbol} 이전 참고 시세`)
    : `${displayedSymbol} 오늘 시세`);
  els.currentPriceLabel.textContent = assessment.referenceOnly ? "마지막 관측가" : "현재가";
  els.openPrice.textContent = displayable ? formatNumber(market.open) : "—";
  els.highPrice.textContent = displayable ? formatNumber(market.high) : "—";
  els.lowPrice.textContent = displayable ? formatNumber(market.low) : "—";
  els.currentPrice.textContent = displayable ? formatNumber(market.current) : "—";
  els.atrValue.textContent = displayable && isFiniteValue(market.atr5m14)
    ? formatNumber(market.atr5m14, " pt")
    : "—";
  els.symbolLabel.textContent = `${providerDescription(state.snapshot)} · ${state.snapshot.session?.label || "수동 세션"}`;
  els.barUpdateText.textContent = formatDate(market.latestBarAt);
  els.lastUpdateText.textContent = formatDate(state.snapshot.generatedAt);
  els.delayText.textContent = delayDescription(state.snapshot, assessment);

  if (!assessment.usable) {
    state.scenarios = null;
    state.operational = null;
    state.autoAtr = displayable && isFiniteValue(market.atr5m14) ? market.atr5m14 : null;
    scheduleExpiryCheck();
    els.useAutoAtrBtn.disabled = !isFiniteValue(state.autoAtr);
    const lockReason = assessment.referenceOnly
      ? `${assessment.reason} 위 첫 기준표는 읽기 전용 검토값입니다.`
      : assessment.reason;
    setCalculationLock(true, lockReason);
    renderPosition();
    return;
  }

  setCalculationLock(false);

  state.scenarios = Object.fromEntries(["bull", "bear"].map(kind => {
    const reference = REFERENCE.directions[kind];
    const safe = Number.isFinite(Number(reference.safePercent)) && Number(reference.safePercent) > 0
      ? calculateSafeReachScenario(market, kind, reference.safePercent)
      : null;
    return [kind, {
      average: calculateVolatilityScenario(market, reference.rangeMeanPercent),
      safe,
      reference
    }];
  }));
  state.operational = {
    up: calculateSafeReachScenario(market, "bull", REFERENCE.exAnte.up.safePercent),
    down: calculateSafeReachScenario(market, "bear", REFERENCE.exAnte.down.safePercent)
  };
  renderOperational("up", state.operational.up, REFERENCE.exAnte.up);
  renderOperational("down", state.operational.down, REFERENCE.exAnte.down);
  renderScenario("bull", state.scenarios.bull.average, state.scenarios.bull.safe,
    state.scenarios.bull.reference, market.current);
  renderScenario("bear", state.scenarios.bear.average, state.scenarios.bear.safe,
    state.scenarios.bear.reference, market.current);
  if (state.snapshot.mode !== "manual" && isFiniteValue(market.atr5m14)) state.autoAtr = market.atr5m14;
  else state.autoAtr = null;
  els.useAutoAtrBtn.disabled = !isFiniteValue(state.autoAtr);
  renderPosition();
  scheduleExpiryCheck();
}

function applySnapshot(snapshot, { cache = true, forceLockReason = "" } = {}) {
  state.snapshot = validateSnapshot(snapshot);
  if (snapshot.mode !== "manual" && snapshot.indicators?.timeframe === "5m") {
    state.chartSnapshot = snapshot;
  }
  state.forceLockReason = forceLockReason;
  const assessment = assessSnapshot(snapshot);
  state.assessment = forceLockReason
    ? {
        ...assessment,
        usable: false,
        calculationAllowed: false,
        referenceOnly: assessment.displayable,
        key: assessment.displayable ? "reference" : "stale",
        reason: forceLockReason
      }
    : assessment;
  if (cache && state.assessment.displayable && snapshot.mode !== "manual") {
    writeJson(SNAPSHOT_CACHE_KEY, snapshot);
  }
  renderMarket();
}

function cooldownRemainingMs(now = Date.now()) {
  const decision = calculateCooldown({
    now,
    memoryRequestedAt: state.lastRequestAt,
    storedRequestedAt: readJson(LAST_REQUEST_KEY, 0)
  });
  if (decision.rebaseAt !== null) {
    // A wall-clock rollback must not turn the request guard into a bypass.
    // Rebase once and require a fresh full cooldown instead of waiting forever.
    state.lastRequestAt = decision.rebaseAt;
    writeJson(LAST_REQUEST_KEY, decision.rebaseAt);
  }
  return decision.remainingMs;
}

function rateLimitRemainingMs(now = Date.now()) {
  const persistedUntil = Number(readJson(RATE_LIMIT_UNTIL_KEY, 0));
  const effectiveUntil = Math.max(
    Number.isFinite(Number(state.rateLimitUntil)) ? Number(state.rateLimitUntil) : 0,
    Number.isFinite(persistedUntil) ? persistedUntil : 0
  );
  const decision = calculateRateLimitBackoff({
    now,
    storedUntil: effectiveUntil
  });
  if (decision.rebaseAt !== null) {
    state.rateLimitUntil = decision.rebaseAt;
    writeJson(RATE_LIMIT_UNTIL_KEY, decision.rebaseAt);
  } else if (decision.remainingMs > 0) {
    state.rateLimitUntil = effectiveUntil;
  }
  if (decision.remainingMs === 0) {
    state.rateLimitUntil = 0;
    try { localStorage.removeItem(RATE_LIMIT_UNTIL_KEY); }
    catch { /* An expired backoff is harmless if private storage rejects cleanup. */ }
  }
  return decision.remainingMs;
}

function requestFailureReason(error) {
  if (error?.metadata?.code === "rate-limited") {
    const now = Date.now();
    const until = rateLimitUntilFromMetadata({
      now,
      retryAfterSeconds: error.metadata.retryAfterSeconds,
      retryAt: error.metadata.retryAt
    });
    if (until > now) {
      state.rateLimitUntil = until;
      writeJson(RATE_LIMIT_UNTIL_KEY, until);
      return `시세 중계 요청이 제한됐습니다. ${Math.ceil((until - now) / 1000)}초 후 사용자가 다시 눌러 주세요.`;
    }
    return "시세 중계 요청이 제한됐습니다. 잠시 후 사용자가 다시 눌러 주세요.";
  }
  if (error?.name === "AbortError") {
    return "시세 중계가 15초 안에 응답하지 않아 중지했습니다.";
  }
  return "새 Yahoo 지연 시세 요청이 실패했습니다.";
}

function loadFallbackSnapshot() {
  const local = readJson(SNAPSHOT_CACHE_KEY);
  if (local) {
    try { return validateSnapshot(local); }
    catch { /* Invalid local cache is ignored. */ }
  }
  return null;
}

function showNoUsableSnapshot(message) {
  clearExpiryTimer();
  state.snapshot = null;
  state.assessment = null;
  state.calculationAllowed = false;
  state.scenarios = null;
  state.operational = null;
  state.autoAtr = null;
  renderReferenceContext();
  renderReferencePrices();
  state.forceLockReason = "";
  els.marketTitle.textContent = "오늘의 시세";
  els.quoteGrid.setAttribute("aria-label", "MNQ 오늘 시세");
  els.currentPriceLabel.textContent = "현재가";
  for (const element of [els.openPrice, els.highPrice, els.lowPrice, els.currentPrice, els.atrValue,
    els.symbolLabel, els.barUpdateText, els.lastUpdateText]) element.textContent = "—";
  els.useAutoAtrBtn.disabled = true;
  state.autoAtr = null;
  setCompactDataStatus("error", "시세 없음");
  els.dataNotice.className = "notice error";
  els.dataNotice.textContent = `${message} 필요하면 아래 ‘수동 시세 직접 입력’을 열어 확인값을 입력하세요.`;
  els.delayText.textContent = "조회 실패 · 계산 중지";
  setCalculationLock(true, "검증된 MNQ 시세가 없습니다.");
  renderPosition();
}

async function showLockedFallback(reason) {
  // Lock all derived values before any fallback I/O. A hanging static request
  // must never leave the previous quote's calculations visible.
  if (state.snapshot) {
    state.transientNotice = "저장된 이전 참고값을 표시만 하며 계산에는 사용하지 않습니다.";
    state.forceLockReason = reason;
    renderMarket();
  } else {
    showNoUsableSnapshot(`${reason} 저장된 이전 참고값을 확인 중이며 계산은 중지됐습니다.`);
  }
  const fallback = loadFallbackSnapshot();
  if (!fallback) {
    if (!state.snapshot) {
      showNoUsableSnapshot(`${reason} 저장된 이전 참고값도 없어 실제 MNQ 값을 수동 입력해야 합니다.`);
    }
    return;
  }
  state.transientNotice = "저장된 이전 참고값을 표시만 하며 계산에는 사용하지 않습니다.";
  applySnapshot(fallback, { cache: false, forceLockReason: reason });
}

async function refreshMarketUnlocked({ trigger = "load" } = {}) {
  setRefreshBusy(true);
  setCompactDataStatus("loading", "조회 중");
  state.transientNotice = "";
  const requestedAt = new Date();
  // Initial weekend load may use the bundled archive immediately. An explicit
  // button press always tries Yahoo first, even during a closure, so a newly
  // reopened session or a later completed bar is never hidden by the archive.
  const preferLocalArchive = trigger !== "button" && shouldPreferLocalArchive(requestedAt);
  const cooldownRemaining = cooldownRemainingMs();
  // A provider-directed backoff must not block the same-origin local archive
  // during the regular weekend closure because no relay request is sent then.
  const backoffRemaining = preferLocalArchive ? 0 : rateLimitRemainingMs();
  const remaining = Math.max(cooldownRemaining, backoffRemaining);
  if (remaining > 0) {
    const seconds = Math.ceil(remaining / 1000);
    const waitingForProvider = backoffRemaining >= cooldownRemaining && backoffRemaining > 0;
    state.transientNotice = waitingForProvider
      ? `시세 중계 호출 제한에 따라 ${seconds}초 후 다시 확인할 수 있습니다.`
      : `반복 요청을 줄이기 위해 ${seconds}초 후 다시 확인할 수 있습니다.`;
    // Re-evaluate the source timestamp before reusing any visible calculation.
    // A wall-clock jump or an expiry boundary must lock immediately instead of
    // waiting for the next scheduled freshness check.
    if (state.snapshot) renderMarket();
    if (state.assessment?.usable) {
      setStatus(state.snapshot, state.assessment);
    } else {
      const reason = waitingForProvider ? "시세 중계 호출 제한 대기 중입니다." : "10초 중복 조회 방지 대기 중입니다.";
      await showLockedFallback(`${reason} ${seconds}초 후 다시 확인하세요.`);
    }
    setRefreshBusy(false);
    document.body.dataset.ready = "true";
    return;
  }

  state.lastRequestAt = Date.now();
  writeJson(LAST_REQUEST_KEY, state.lastRequestAt);
  try {
    let result = null;
    let localFailure = null;
    let remoteFailure = null;
    if (preferLocalArchive) {
      try {
        const localSnapshot = validateSnapshot(await fetchLocalNasdaqSnapshot(fetch));
        const localAssessment = assessSnapshot(localSnapshot);
        if (!localAssessment.displayable) {
          throw new Error(localAssessment.reason || "로컬 NQ 참고값을 표시할 수 없습니다.");
        }
        result = { snapshot: localSnapshot, source: "local", remoteFailure: null };
      } catch (error) {
        localFailure = error;
      }
    }
    if (!result) {
      let remoteSnapshot = null;
      let localSnapshot = null;
      try {
        remoteSnapshot = validateSnapshot(
          await fetchYahooSnapshot(fetch, requestedAt, { timeoutMs: REQUEST_DEADLINE_MS })
        );
      } catch (error) {
        remoteFailure = error;
      }
      const remoteAssessment = remoteSnapshot ? assessSnapshot(remoteSnapshot, requestedAt) : null;
      // A current usable MNQ quote wins immediately. Reference-only or failed
      // remote results are compared with the user's archive and current view by
      // source-bar time so refresh can never replace a newer observation with
      // an older one.
      if (!remoteAssessment?.usable) {
        try {
          localSnapshot = validateSnapshot(await fetchLocalNasdaqSnapshot(fetch));
        } catch (error) {
          localFailure = error;
        }
      }
      const best = selectBestSnapshotCandidate([
        ...(remoteSnapshot ? [{ snapshot: remoteSnapshot, source: "remote" }] : []),
        ...(localSnapshot ? [{ snapshot: localSnapshot, source: "local" }] : []),
        ...(state.snapshot ? [{ snapshot: state.snapshot, source: "current" }] : [])
      ], requestedAt);
      if (!best) throw remoteFailure || localFailure || new Error("표시 가능한 최근 시세가 없습니다.");
      result = { snapshot: best.snapshot, source: best.source, remoteFailure };
    }
    const snapshot = validateSnapshot(result.snapshot);
    const assessment = assessSnapshot(snapshot);
    if (result.source === "local" && !assessment.displayable) {
      throw result.remoteFailure || new Error(assessment.reason || "로컬 NQ 참고값을 표시할 수 없습니다.");
    }
    if (result.source === "remote") {
      state.rateLimitUntil = 0;
      try { localStorage.removeItem(RATE_LIMIT_UNTIL_KEY); }
      catch { /* Successful data is already verified; stale backoff cleanup is best-effort. */ }
      state.transientNotice = trigger === "load"
        ? "이 화면을 열어 Yahoo 지연 시세를 한 번 조회했습니다. 백그라운드 갱신은 없습니다."
        : "버튼 요청으로 Yahoo 지연 시세를 한 번 조회했습니다. 백그라운드 갱신은 없습니다.";
    } else if (result.source === "local") {
      const remoteDetail = result.remoteFailure
        ? ` ${requestFailureReason(result.remoteFailure)}`
        : "";
      state.transientNotice = `주말·휴장용으로 동기화된 로컬 NQ 최근 완료 세션을 불러왔습니다.${remoteDetail}`;
    } else {
      const remoteDetail = result.remoteFailure ? ` ${requestFailureReason(result.remoteFailure)}` : "";
      state.transientNotice = `새 조회보다 기존 관측값이 더 최근이어서 그대로 유지했습니다.${remoteDetail}`;
    }
    applySnapshot(snapshot, {
      cache: assessment.displayable && result.source !== "current",
      forceLockReason: result.source === "current" && result.remoteFailure
        ? "새 Yahoo 조회가 실패해 기존 관측값을 표시합니다."
        : ""
    });
  } catch (error) {
    const failureReason = requestFailureReason(error);
    // Manual input may remain usable after a network failure, but its 25-minute
    // freshness contract is checked again at the exact failure boundary.
    if (state.snapshot?.mode === "manual") renderMarket();
    if (state.snapshot?.mode === "manual" && state.assessment?.usable) {
      state.transientNotice = `${failureReason} 수동 확인값을 유지합니다.`;
      setStatus(state.snapshot, state.assessment);
    } else {
      await showLockedFallback(`${failureReason} 이전 값으로 자동 계산하지 않습니다.`);
    }
  } finally {
    setRefreshBusy(false);
    document.body.dataset.ready = "true";
  }
}

async function refreshMarket(options = {}) {
  const result = await withExclusiveRequest(() => refreshMarketUnlocked(options));
  if (result.acquired) return result.value;
  if (["storage-unavailable", "clock-unavailable"].includes(result.reason)) {
    state.transientNotice = "요청 보호 저장소를 확인할 수 없어 자동 시세 조회를 보내지 않았습니다.";
    if (state.snapshot) renderMarket();
    else showNoUsableSnapshot("요청 보호 저장소를 사용할 수 없어 자동 시세 조회를 중지했습니다. 수동 입력을 사용해 주세요.");
    setRefreshBusy(false);
    document.body.dataset.ready = "true";
    return undefined;
  }
  state.transientNotice = "다른 탭에서 이미 시세를 확인 중입니다. 중복 요청을 보내지 않았습니다.";
  if (state.snapshot) renderMarket();
  else showNoUsableSnapshot("다른 탭에서 시세를 확인 중입니다. 잠시 후 다시 눌러 주세요.");
  setRefreshBusy(false);
  document.body.dataset.ready = "true";
  return undefined;
}

function positionInput() {
  return {
    direction: els.positionDirection.value,
    entry: els.entryPrice.value,
    enteredAt: els.enteredAt.value,
    currentQuantity: els.currentQuantity.value,
    maxQuantity: els.maxQuantity.value,
    addCount: els.addCount.value
  };
}

function positionMarketContext() {
  const market = state.snapshot?.market;
  const assessment = state.assessment;
  if (!market || assessment?.displayable !== true ||
      !isFiniteValue(market.current) || !isFiniteValue(market.atr5m14)) return null;
  const referenceOnly = assessment.referenceOnly === true;
  const sourceLabel = state.snapshot.mode === "local-archive" ? "최근 완료 NQ" :
    referenceOnly ? "최근 관측 MNQ" : state.snapshot.mode === "manual" ? "수동 확인 MNQ" : "검증 MNQ";
  return {
    current: Number(market.current),
    atr5m14: Number(market.atr5m14),
    latestBarAt: market.latestBarAt,
    ageMinutes: assessment.ageMinutes,
    referenceOnly,
    sourceLabel
  };
}

function renderPositionLossRisk(input, marketContext) {
  return assessPositionLossRisk({
    ...input,
    current: marketContext.current,
    atr5m14: marketContext.atr5m14
  });
}

function renderTailLossChecklist(result) {
  const verdicts = {
    critical: "적색 · 즉시 축소·청산 재평가",
    danger: "위험 · 추가 진입 금지",
    caution: "경계 · 추가 진입 중단",
    watch: "주의 · 손실 확대 감시",
    safe: "현재 체크리스트 미해당"
  };
  const needsInput = !result.complete && result.triggeredRuleIds.length === 0;
  const headline = needsInput ? "판정 보류 · 정밀입력 필요" : verdicts[result.severity];
  const issueText = result.inputIssues.length ? ` ${result.inputIssues.join(" ")}` : "";
  const summary = `${result.action}${result.complete ? "" : " 미확인 항목은 안전으로 계산하지 않습니다."}${issueText}`;
  const statusLabels = {
    triggered: ["해당", "triggered"], clear: ["미해당", "clear"],
    pending: ["시간 미도달", "pending"], incomplete: ["입력 필요", "incomplete"]
  };
  els.positionRiskPanel.className = `position-risk-panel ${needsInput ? "incomplete" : result.severity}`;
  els.positionRiskHeadline.textContent = headline;
  els.positionRiskSummary.textContent = summary;
  const currentGross = result.currentGrossUsd === null ? "—" :
    `${result.currentGrossUsd < 0 ? "−" : "+"}$${numberFormat.format(Math.abs(result.currentGrossUsd))}`;
  const stopGate = result.experimentalStopGate === null ? "입력 필요" :
    result.experimentalStopGate ? "해당 · 적색" : "미해당";
  els.positionRiskMetrics.innerHTML = `
    <span>우선순위 점수 <strong>${result.riskPoints} / ${result.maxRiskPoints}</strong></span>
    <span>검증 항목 <strong>${result.knownCount} / ${result.totalCount}</strong></span>
    <span>현재 평가손익 <strong>${currentGross}</strong></span>
    <span>60분·−$500 실험 게이트 <strong>${stopGate}</strong></span>
    <span>−1.84 ATR 관찰선 <strong>${result.lossMedianPrice === null ? "—" : formatNumber(result.lossMedianPrice)}</strong></span>
    <span>4시간 위험선 <strong>${result.fourHourRiskPrice === null ? "—" : formatNumber(result.fourHourRiskPrice)}</strong></span>`;
  els.positionRiskChecklist.innerHTML = result.rules.map((rule, index) => {
    const [statusLabel, statusClass] = statusLabels[rule.status];
    return `<li class="${statusClass}"><span class="risk-rule-number">${index + 1}</span><div><strong>${rule.label}</strong><small>${rule.threshold}</small></div><b>${statusLabel}</b></li>`;
  }).join("");
}

function renderPosition() {
  const input = positionInput();
  writeJson(POSITION_KEY, input);
  if (state.snapshot && state.calculationAllowed) {
    const currentAssessment = assessSnapshot(state.snapshot);
    if (!currentAssessment.usable) {
      state.assessment = currentAssessment;
      state.forceLockReason = "";
      renderMarket();
      return;
    }
  }
  const marketContext = positionMarketContext();
  if (!marketContext) {
    els.positionEmpty.hidden = false;
    els.positionEmpty.textContent = state.snapshot && state.assessment?.displayable
      ? "자동 5분 ATR을 계산할 최신 연속 완료봉 14개가 부족합니다. 나스닥 데이터를 동기화하거나 오늘 시세를 다시 확인하세요."
      : state.snapshot
        ? "사용 가능한 현재가를 검증하지 못해 위험 패턴 판정을 중지했습니다. 나스닥 데이터를 동기화하거나 실제 MNQ 값을 수동 확인하세요."
        : POSITION_EMPTY_MESSAGE;
    els.positionResults.hidden = true;
    renderRisk();
    return;
  }
  if (input.direction === "none") {
    els.positionEmpty.hidden = false;
    els.positionEmpty.textContent = POSITION_EMPTY_MESSAGE;
    els.positionResults.hidden = true;
    renderRisk();
    return;
  }
  try {
    const entry = Number(input.entry);
    if (!Number.isFinite(entry) || entry <= 0) throw new Error("체결가격을 입력하세요.");
    if (Math.abs(entry / 0.25 - Math.round(entry / 0.25)) > 1e-6) {
      throw new Error("체결가격은 MNQ 0.25포인트 틱에 맞아야 합니다.");
    }
    if (!input.enteredAt) throw new Error("체결시간을 입력하세요.");
    const result = renderPositionLossRisk(input, marketContext);
    const ageText = Number.isFinite(marketContext.ageMinutes)
      ? `${Math.max(0, Math.round(marketContext.ageMinutes))}분 전 관측`
      : "관측시각 미확인";
    els.positionSummary.innerHTML = `
      <article><span>${marketContext.referenceOnly ? "마지막 관측가" : "현재가"}</span><strong>${formatNumber(marketContext.current)}</strong></article>
      <article><span>자동 5분 ATR(14)</span><strong>${formatNumber(marketContext.atr5m14, " pt")}</strong></article>
      <article><span>진입 대비 방향성 변동</span><strong class="${result.signedMovePoints < 0 ? "money-negative" : result.signedMovePoints > 0 ? "money-positive" : ""}">${formatNumber(result.signedMovePoints, " pt")}</strong></article>`;
    els.positionMarketNote.textContent = `${marketContext.sourceLabel} · ${ageText} · ${formatDate(marketContext.latestBarAt)}${marketContext.referenceOnly ? " · 최근 관측 참고값" : ""}`;
    els.positionEmpty.hidden = true;
    els.positionResults.hidden = false;
  } catch (error) {
    els.positionEmpty.hidden = false;
    els.positionEmpty.textContent = error.message;
    els.positionResults.hidden = true;
  }
  renderRisk();
}

function restorePosition() {
  const saved = readJson(POSITION_KEY, {});
  els.positionDirection.value = ["long", "short"].includes(saved.direction) ? saved.direction : "none";
  els.entryPrice.value = saved.entry ?? "";
  els.enteredAt.value = saved.enteredAt ?? "";
  els.currentQuantity.value = saved.currentQuantity ?? "";
  els.maxQuantity.value = saved.maxQuantity ?? "";
  els.addCount.value = saved.addCount ?? "";
}

function setRiskCard(element, tone, title, description) {
  element.className = `risk-card ${tone}`;
  element.querySelector("strong").textContent = title;
  element.querySelector("p").textContent = description;
}

function renderRisk() {
  const input = positionInput();
  const marketContext = positionMarketContext();
  const chartSnapshot = state.snapshot?.indicators?.timeframe === "5m"
    ? state.snapshot
    : state.chartSnapshot;
  const indicators = chartSnapshot?.indicators;
  if (input.direction === "none" || !input.entry || !input.enteredAt) {
    els.patternEmpty.hidden = false;
    els.patternEmpty.textContent = "방향·체결가격·체결시간을 입력하면 차트 지표와 현재 거래 패턴 경향을 자동 계산합니다.";
    els.patternResults.hidden = true;
    return;
  }
  if (!marketContext) {
    els.patternEmpty.hidden = false;
    els.patternEmpty.textContent = "현재가와 자동 ATR을 검증하지 못해 대손실 체크리스트를 판정할 수 없습니다.";
    els.patternResults.hidden = true;
    return;
  }

  const positionRisk = assessPositionLossRisk({
    ...input,
    current: marketContext.current,
    atr5m14: marketContext.atr5m14
  });
  const path = calculatePositionPathFeatures(chartSnapshot?.chart5m, input, marketContext.atr5m14);
  const tailLoss = assessTailLossAvoidance({
    ...input,
    holdingMinutes: positionRisk.holdingMinutes,
    signedMoveAtr: positionRisk.signedMoveAtr,
    signedMovePoints: positionRisk.signedMovePoints,
    atr5m14: marketContext.atr5m14,
    maeAtr: path?.maeAtr,
    pathComplete: path?.completeFromEntry === true
  });
  renderTailLossChecklist(tailLoss);
  if (!indicators || indicators.timeframe !== "5m") {
    els.patternEmpty.hidden = false;
    els.patternEmpty.textContent = "체크리스트는 판정했지만 EMA·RSI·패턴 경향을 계산할 완료 5분봉 차트가 부족합니다.";
    els.patternResults.hidden = true;
    return;
  }
  const result = classifyPatternRisk({
    ema1h: indicators.emaRegime,
    rsi1h: indicators.rsi14,
    atrPercentile: indicators.atrPercentile20d,
    enteredAt: input.enteredAt,
    mfeAtr: path?.mfeAtr
  });
  const tendency = classifyLiveTradePattern({
    holdingMinutes: positionRisk.holdingMinutes,
    signedMoveAtr: positionRisk.signedMoveAtr,
    atrPercentile: indicators.atrPercentile20d,
    mfeAtr: path?.mfeAtr,
    maeAtr: path?.maeAtr,
    pathComplete: path?.completeFromEntry === true
  });
  if (!tendency) {
    els.patternEmpty.hidden = false;
    els.patternEmpty.textContent = "입력값의 시간·가격을 확인할 수 없어 패턴 경향 계산을 보류했습니다.";
    els.patternResults.hidden = true;
    return;
  }

  els.patternHeadline.textContent = `패턴 ${tendency.number} · ${tendency.name}`;
  els.patternSummary.textContent = tendency.caution;
  els.patternEvidence.innerHTML = [
    ...tendency.evidence,
    `판정 신뢰도 ${tendency.confidence}`,
    `과거 군집 비중 ${tendency.historicalSharePercent.toFixed(1)}%`,
    `최고 위험등급 손실률 ${TAIL_LOSS_AVOIDANCE_EVIDENCE.highestRiskBandLossRatePercent.toFixed(0)}%`
  ].map(value => `<span>${value}</span>`).join("");
  els.patternIndicators.innerHTML = `
    <article><span>5분 EMA50 / EMA200</span><strong>${formatNumber(indicators.ema50)} / ${formatNumber(indicators.ema200)}</strong><small>${indicators.emaRegime === "bearish" ? "약세 배열" : "강세 배열"}</small></article>
    <article><span>5분 RSI14</span><strong>${Number(indicators.rsi14).toFixed(1)}</strong><small>${Number(indicators.rsi14) < 45 ? "약세 주의" : Number(indicators.rsi14) > 55 ? "강세 구간" : "중립 구간"}</small></article>
    <article><span>ATR% 20세션 백분위</span><strong>${Number(indicators.atrPercentile20d).toFixed(1)}</strong><small>n=${Number(indicators.atrPercentileSampleCount).toLocaleString("ko-KR")}</small></article>
    <article><span>진입 후 MFE / MAE</span><strong>${path ? `${path.mfeAtr.toFixed(2)} / ${path.maeAtr.toFixed(2)} ATR` : "차트 대기"}</strong><small>${path?.completeFromEntry ? `${path.barCount}개 완료봉` : "경로 일부 또는 미관측"}</small></article>`;
  els.patternEmpty.hidden = true;
  els.patternResults.hidden = false;

  if (!result.p6Complete) {
    setRiskCard(els.p6Result, "caution", "자동 지표 부족", "EMA·RSI·ATR 백분위의 완료봉 표본이 부족합니다.");
  } else if (result.p6Forbidden) {
    setRiskCard(els.p6Result, "danger", "고변동·약세 복합 경고", "ATR 백분위 75 이상과 EMA/RSI 약세가 동시에 관측됐습니다. 추격·추가 진입을 피하고 청산 기준을 확인하세요.");
  } else {
    setRiskCard(els.p6Result, "safe", "복합 경고 미해당", "고변동성과 약세 레짐이 동시에 나타나지 않았습니다.");
  }
  if (!result.killComplete) {
    setRiskCard(els.killResult, "caution", "시장 레짐 계산 대기", "완료 5분봉 지표가 더 필요합니다.");
  } else if (result.globalKillSwitch) {
    setRiskCard(els.killResult, "caution", "시장 환경 주의", "EMA 약세, RSI<45, 고변동 중 하나 이상입니다. 단독 조건만으로 청산하지 말고 포지션 위험 단계와 함께 보세요.");
  } else {
    setRiskCard(els.killResult, "safe", "시장 환경 중립", "EMA·RSI·ATR 기준의 주의 조건이 현재는 감지되지 않았습니다.");
  }
  if (!result.p7Complete) {
    setRiskCard(els.p7Result, "caution", "진입 후 경로 대기", "체결시간 이후 완료 5분봉이 생기면 최대유리변동을 자동 점검합니다.");
  } else if (result.p7Forbidden) {
    setRiskCard(els.p7Result, "caution", "10분 무반응 경고", `${Math.floor(result.holdingMinutes)}분 동안 최대유리변동이 0.25 ATR 미만입니다. 진입 근거와 최초 청산 기준을 다시 확인하세요.`);
  } else {
    setRiskCard(els.p7Result, "safe", "유리 변동 관측", `${Math.floor(result.holdingMinutes)}분 보유 중 최대유리변동이 ${path.mfeAtr.toFixed(2)} ATR입니다.`);
  }
}

function setManualPanelExpanded(expanded, { returnFocus = false } = {}) {
  const shouldExpand = Boolean(expanded);
  const focusWasInside = els.manualPanel.contains(document.activeElement);
  els.manualToggleBtn.setAttribute("aria-expanded", String(shouldExpand));
  els.manualPanel.hidden = !shouldExpand;
  if (!shouldExpand && returnFocus && focusWasInside) els.manualToggleBtn.focus();
}

els.manualToggleBtn.addEventListener("click", () => {
  const expanded = els.manualToggleBtn.getAttribute("aria-expanded") === "true";
  setManualPanelExpanded(!expanded, { returnFocus: expanded });
});

els.manualPanel.addEventListener("submit", event => {
  event.preventDefault();
  if (!els.manualConfirm.checked) {
    els.manualError.textContent = "실제 MNQ 월물 값을 방금 직접 확인했다는 항목에 체크해야 합니다.";
    els.manualConfirm.focus();
    return;
  }
  const candidate = {
    open: els.manualOpen.value, high: els.manualHigh.value, low: els.manualLow.value,
    current: els.manualCurrent.value, atr5m14: els.manualAtr.value
  };
  const validation = validateMarketBar(candidate);
  if (!validation.valid) {
    els.manualError.textContent = validation.errors.join(" ");
    return;
  }
  els.manualError.textContent = "";
  const confirmedAt = new Date().toISOString();
  const manual = {
    schemaVersion: 1, mode: "manual", generatedAt: confirmedAt,
    provider: {
      name: "사용자 수동 입력", requestedSymbol: "MNQ 실제월물",
      returnedSymbol: "MNQ 수동", actualContractConfirmed: true, confirmedAt
    },
    session: { label: "사용자 확인 세션", timeZone: "Asia/Seoul" },
    market: { ...validation.values, latestBarAt: confirmedAt }
  };
  els.manualConfirm.checked = false;
  state.transientNotice = "";
  applySnapshot(manual, { cache: false });
  setManualPanelExpanded(false, { returnFocus: true });
});

els.useAutoAtrBtn.addEventListener("click", () => {
  if (isFiniteValue(state.autoAtr)) els.manualAtr.value = state.autoAtr;
});
els.refreshBtn.addEventListener("click", () => refreshMarket({ trigger: "button" }));
els.positionForm.addEventListener("input", renderPosition);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.snapshot) renderMarket();
});
window.addEventListener("focus", () => {
  if (state.snapshot) renderMarket();
});
window.addEventListener("pageshow", () => {
  if (state.snapshot) renderMarket();
});

els.bullMeanReference.textContent = formatPercent(REFERENCE.directions.bull.rangeMeanPercent);
els.bullSafeReference.textContent = formatPercent(REFERENCE.exAnte.up.safePercent);
els.bearMeanReference.textContent = formatPercent(REFERENCE.directions.bear.rangeMeanPercent);
els.bearSafeReference.textContent = formatPercent(REFERENCE.exAnte.down.safePercent);
els.bullConditionalReference.textContent = formatPercent(REFERENCE.directions.bull.safePercent);
els.bearConditionalReference.textContent = formatPercent(REFERENCE.directions.bear.safePercent);
els.bullLiveLabel.textContent = `장중 기본 상승선 · OOS ${formatPercent(REFERENCE.exAnte.up.walkForwardHitRate, 1)}`;
els.bearLiveLabel.textContent = `장중 기본 하락선 · OOS ${formatPercent(REFERENCE.exAnte.down.walkForwardHitRate, 1)}`;
els.operationalUpLabel.textContent = els.bullLiveLabel.textContent;
els.operationalDownLabel.textContent = els.bearLiveLabel.textContent;
els.bullConditionalLabel.textContent = `양봉 마감 조건부 복기선 · OOS ${formatPercent(REFERENCE.directions.bull.walkForwardHitRate, 1)}`;
els.bearConditionalLabel.textContent = `음봉 마감 조건부 복기선 · OOS ${formatPercent(REFERENCE.directions.bear.walkForwardHitRate, 1)}`;
els.bullReferenceConditionalLabel.textContent = els.bullConditionalLabel.textContent;
els.bearReferenceConditionalLabel.textContent = els.bearConditionalLabel.textContent;
els.referencePeriod.textContent = `${REFERENCE.effectiveFrom} ~ ${REFERENCE.effectiveThrough} · q25 · ${REFERENCE.sourceSymbol}`;
const todayKst = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
if (todayKst > REFERENCE.effectiveThrough) {
  els.referencePeriod.textContent += " · 기준 만료—월요일 갱신 필요";
  els.referencePeriod.style.color = "var(--amber)";
}
restorePosition();
try { localStorage.removeItem(LEGACY_MANUAL_KEY); }
catch { /* Legacy manual values are intentionally not restored. */ }
setManualPanelExpanded(false);
renderRisk();
const cachedSnapshot = loadFallbackSnapshot();
if (cachedSnapshot) {
  const cachedAssessment = assessSnapshot(cachedSnapshot);
  if (cachedAssessment.displayable) {
    state.transientNotice = cachedAssessment.referenceOnly
      ? "새 시세를 확인하기 전 최근 완료 세션 참고값을 먼저 표시했습니다."
      : "새 시세를 확인하기 전 마지막 검증값을 먼저 표시했습니다.";
    applySnapshot(cachedSnapshot, {
      cache: false,
      forceLockReason: cachedAssessment.referenceOnly
        ? ""
        : "새 시세를 확인하기 전 마지막 검증값을 읽기 전용으로 표시합니다."
    });
  }
}
refreshMarket({ trigger: "load" });
