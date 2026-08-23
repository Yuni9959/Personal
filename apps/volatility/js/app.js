import {
  WEEKLY_VOLATILITY_REFERENCE as REFERENCE,
  calculatePositionScenario,
  calculateSafeReachScenario,
  calculateVolatilityScenario,
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
  sourceAgeMinutes
} from "./snapshot-policy.js";

const SNAPSHOT_CACHE_KEY = "personal-tap-volatility-snapshot-v1";
const LAST_REQUEST_KEY = "personal-tap-volatility-last-request-v1";
const RATE_LIMIT_UNTIL_KEY = "personal-tap-volatility-rate-limit-until-v1";
const LEGACY_MANUAL_KEY = "personal-tap-volatility-manual-v1";
const POSITION_KEY = "personal-tap-volatility-position-v1";
const RISK_KEY = "personal-tap-volatility-risk-v1";

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
  quantity: $("#quantity"), fees: $("#fees"), positionAtr: $("#positionAtr"), enteredAt: $("#enteredAt"),
  positionEmpty: $("#positionEmpty"), positionResults: $("#positionResults"),
  positionSummary: $("#positionSummary"), positionScenarioGrid: $("#positionScenarioGrid"),
  riskForm: $("#riskForm"), ema1h: $("#ema1h"), rsi1h: $("#rsi1h"),
  atrPercentile: $("#atrPercentile"), noFavorableExcursion: $("#noFavorableExcursion"),
  stopHesitation: $("#stopHesitation"), p6Result: $("#p6Result"), killResult: $("#killResult"), p7Result: $("#p7Result")
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
  assessment: null,
  scenarios: null,
  operational: null,
  autoAtr: null,
  calculationAllowed: false,
  lastRequestAt: 0,
  rateLimitUntil: 0,
  forceLockReason: "",
  positionAtrBinding: { identity: "", source: "", sourceBarAt: "", capturedAt: "" },
  expiryTimer: null,
  transientNotice: ""
};
const POSITION_EMPTY_MESSAGE = "포지션을 입력하면 MNQ $2/point 기준 시나리오 손익과 1.0×5분 ATR 손절선을 보여줍니다.";
const numberFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
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

function positionIdentity(input = positionInput()) {
  const direction = input?.direction;
  const entry = Number(input?.entry);
  const enteredAt = String(input?.enteredAt || "");
  if (!['long', 'short'].includes(direction) || !Number.isFinite(entry) || entry <= 0) return "";
  return `${direction}|${entry}|${enteredAt || "time-unset"}`;
}

function resetPositionAtrBinding() {
  state.positionAtrBinding = { identity: "", source: "", sourceBarAt: "", capturedAt: "" };
}

function isValidAtrBinding(binding, identity) {
  if (!binding || binding.identity !== identity ||
      !["validated-provider-snapshot", "confirmed-manual-snapshot", "user-fixed"]
        .includes(binding.source) ||
      !Number.isFinite(new Date(binding.capturedAt || "").getTime())) return false;
  if (["validated-provider-snapshot", "confirmed-manual-snapshot"].includes(binding.source)) {
    return Number.isFinite(new Date(binding.sourceBarAt || "").getTime());
  }
  return true;
}

function capturePositionAtrFromSnapshot() {
  const identity = positionIdentity();
  const atr = state.snapshot?.market?.atr5m14;
  if (!identity || !state.calculationAllowed || !isFiniteValue(atr)) return;
  els.positionAtr.value = atr;
  state.positionAtrBinding = {
    identity,
    source: state.snapshot?.mode === "manual" ? "confirmed-manual-snapshot" : "validated-provider-snapshot",
    sourceBarAt: state.snapshot.market.latestBarAt,
    capturedAt: new Date().toISOString()
  };
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
    const referenceLabel = ["completed-session", "local-completed-session"].includes(assessment.marketState)
      ? "최근 완료 세션 참고"
      : "이전 검증 시세 참고";
    return `${age} · ${referenceLabel} · 계산 잠금`;
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
    return "로컬 보관 5분봉 1개가 누락되어 ATR은 제공하지 않습니다.";
  }
  if (!assessment.displayable || snapshot?.mode === "manual" ||
      provider.barQuality !== "one-interior-null-bucket" || missingCount !== 1) return "";
  return provider.regularMarketOpenMetadataAvailable
    ? "5분봉 1개 결손 · 일중 O/H/L/현재가·시각은 공급자 메타와 교차검증 · ATR/손절 자동 계산 중지"
    : "5분봉 1개 결손 · H/L/현재가·시각은 공급자 메타와 교차검증, 시가는 첫 세션봉 기준 · ATR/손절 자동 계산 중지";
}

function setStatus(snapshot, assessment = assessSnapshot(snapshot)) {
  const isActiveManual = snapshot?.mode === "manual" && assessment.usable;
  const ageMinutes = assessment.ageMinutes === null
    ? null
    : Math.max(0, Math.round(assessment.ageMinutes));
  if (isActiveManual) setCompactDataStatus("manual", "수동 입력");
  else if (assessment.usable) setCompactDataStatus("delayed", "시세 사용 가능");
  else if (assessment.referenceOnly) {
    setCompactDataStatus("aging", assessment.marketState === "completed-session"
      ? "최근 세션 참고"
      : "이전 시세 참고");
  }
  else if (assessment.key === "stale") setCompactDataStatus("stale", "시세 만료");
  else setCompactDataStatus("error", "시세 없음");
  els.dataNotice.className = "notice";
  if (isActiveManual) {
    els.dataNotice.textContent = "수동 입력값으로 계산 중입니다. 주문 전 실제 월물 시세와 다시 대조하세요.";
  } else if (assessment.referenceOnly) {
    els.dataNotice.classList.add("warning");
    const sourceLabel = ["completed-session", "local-completed-session"].includes(assessment.marketState)
      ? "최근 완료 세션"
      : "이전에 검증한 세션";
    const referenceDetail = assessment.referenceLineCalculationAllowed
      ? "이번 주 기준 환산선도 함께 표시하지만"
      : "주간 기준 환산선은 잠그고";
    els.dataNotice.textContent = `${assessment.reason} ${sourceLabel}의 O/H/L/마지막 관측가를 표시하고 ${referenceDetail} 포지션·ATR·손절 계산은 잠급니다.`;
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
  els.marketTitle.textContent = assessment.referenceOnly
    ? (completedSessionPreview ? "최근 완료 세션" : "이전 참고 시세")
    : "오늘의 시세";
  const displayedSymbol = state.snapshot.mode === "local-archive" ? "NQ" : "MNQ";
  els.quoteGrid.setAttribute("aria-label", assessment.referenceOnly
    ? (completedSessionPreview ? `${displayedSymbol} 최근 완료 세션 참고 시세` : `${displayedSymbol} 이전 참고 시세`)
    : `${displayedSymbol} 오늘 시세`);
  els.currentPriceLabel.textContent = assessment.referenceOnly ? "마지막 관측가" : "현재가";
  els.openPrice.textContent = displayable ? formatNumber(market.open) : "—";
  els.highPrice.textContent = displayable ? formatNumber(market.high) : "—";
  els.lowPrice.textContent = displayable ? formatNumber(market.low) : "—";
  els.currentPrice.textContent = displayable ? formatNumber(market.current) : "—";
  els.atrValue.textContent = assessment.usable ? formatNumber(market.atr5m14, " pt") : "—";
  els.symbolLabel.textContent = `${providerDescription(state.snapshot)} · ${state.snapshot.session?.label || "수동 세션"}`;
  els.barUpdateText.textContent = formatDate(market.latestBarAt);
  els.lastUpdateText.textContent = formatDate(state.snapshot.generatedAt);
  els.delayText.textContent = delayDescription(state.snapshot, assessment);

  if (!assessment.usable) {
    state.scenarios = null;
    state.operational = null;
    state.autoAtr = null;
    scheduleExpiryCheck();
    els.useAutoAtrBtn.disabled = true;
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
  // The stop ATR is captured once for a position identity. A later quote must
  // never move a fixed stop silently; only a new position identity can rebind it.
  if (!isFiniteValue(els.positionAtr.value)) capturePositionAtrFromSnapshot();
  renderPosition();
  scheduleExpiryCheck();
}

function applySnapshot(snapshot, { cache = true, forceLockReason = "" } = {}) {
  state.snapshot = validateSnapshot(snapshot);
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
  const preferLocalArchive = shouldPreferLocalArchive(requestedAt);
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
      try {
        result = {
          snapshot: await fetchYahooSnapshot(fetch, requestedAt, { timeoutMs: REQUEST_DEADLINE_MS }),
          source: "remote",
          remoteFailure: null
        };
      } catch (remoteFailure) {
        try {
          result = {
            snapshot: await fetchLocalNasdaqSnapshot(fetch),
            source: "local",
            remoteFailure
          };
        } catch {
          throw remoteFailure || localFailure;
        }
      }
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
    } else {
      const remoteDetail = result.remoteFailure
        ? ` ${requestFailureReason(result.remoteFailure)}`
        : "";
      state.transientNotice = `주말·휴장용으로 동기화된 로컬 NQ 최근 완료 세션을 불러왔습니다.${remoteDetail}`;
    }
    applySnapshot(snapshot, { cache: assessment.displayable });
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
    quantity: els.quantity.value,
    fees: els.fees.value,
    atr5m14: els.positionAtr.value,
    enteredAt: els.enteredAt.value
  };
}

function moneyClass(value) {
  return value > 0 ? "money-positive" : value < 0 ? "money-negative" : "";
}

function renderPosition() {
  const input = positionInput();
  const identity = positionIdentity(input);
  writeJson(POSITION_KEY, {
    ...input,
    atr5m14: identity && isFiniteValue(input.atr5m14) ? input.atr5m14 : "",
    positionIdentity: identity,
    atrBinding: identity ? state.positionAtrBinding : null
  });
  if (state.snapshot && state.calculationAllowed) {
    const currentAssessment = assessSnapshot(state.snapshot);
    if (!currentAssessment.usable) {
      state.assessment = currentAssessment;
      state.forceLockReason = "";
      renderMarket();
      return;
    }
  }
  if (!state.snapshot || !state.calculationAllowed || !state.scenarios) {
    els.positionEmpty.hidden = false;
    els.positionEmpty.textContent = state.assessment?.referenceOnly
      ? (state.assessment.marketState === "completed-session"
          ? "최근 완료 세션은 읽기 전용 참고값입니다. 포지션·손절 계산은 검증된 진행 시세 또는 직접 확인한 수동 시세에서만 열립니다."
          : "이전에 검증한 시세는 새 조회 전 읽기 전용 참고값입니다. 포지션·손절 계산은 새 공급자 응답 또는 직접 확인한 수동 시세에서만 열립니다.")
      : state.snapshot
        ? "시세가 오래됐거나 MNQ가 아닌 대체값이어서 포지션 계산을 중지했습니다. 실제 MNQ 값을 수동 입력하세요."
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
    if (!state.operational?.up || !state.operational?.down) {
      throw new Error("안전측 분석값이 확정된 뒤 포지션 시나리오를 계산할 수 있습니다.");
    }
    const up = calculatePositionScenario(input, state.snapshot.market, state.operational.up);
    const down = calculatePositionScenario(input, state.snapshot.market, state.operational.down);
    els.positionSummary.innerHTML = `
      <article><span>현재 순손익 가정</span><strong class="${moneyClass(up.currentNetUsd)}">${moneyFormat.format(up.currentNetUsd)}</strong></article>
      <article><span>1.0×5분 ATR 고정 손절선</span><strong>${formatNumber(up.stopPrice)}</strong></article>
      <article><span>손절 체결 시 순손익 가정</span><strong class="${moneyClass(up.stopNetUsd)}">${moneyFormat.format(up.stopNetUsd)}</strong></article>`;
    els.positionScenarioGrid.innerHTML = [
      ["상승 실전 기본선", up, REFERENCE.exAnte.up],
      ["하락 실전 기본선", down, REFERENCE.exAnte.down]
    ].map(([title, result, reference]) => `
      <article>
        <h3>${title}</h3>
        <p><span>시가 기준 안전측 선 (${formatPercent(reference.safePercent)})</span><strong>${formatNumber(result.thresholdPrice)}</strong></p>
        <p><span>현재가→가격선 손익 변화 (비용 미차감)</span><strong class="${moneyClass(result.incrementalGrossUsd)}">${moneyFormat.format(result.incrementalGrossUsd)}</strong></p>
        <p><span>진입가→가격선 순손익 가정</span><strong class="${moneyClass(result.projectedNetUsd)}">${moneyFormat.format(result.projectedNetUsd)}</strong></p>
        <p><span>현재가→가격선 포인트</span><strong class="${moneyClass(result.incrementalPoints)}">${formatNumber(result.incrementalPoints, " pt")}</strong></p>
      </article>`).join("");
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
  els.quantity.value = saved.quantity || "1";
  els.fees.value = saved.fees ?? "0";
  els.enteredAt.value = saved.enteredAt ?? "";
  const identity = positionIdentity();
  if (identity && saved.positionIdentity === identity && isFiniteValue(saved.atr5m14) &&
      isValidAtrBinding(saved.atrBinding, identity)) {
    els.positionAtr.value = saved.atr5m14;
    state.positionAtrBinding = {
      identity,
      source: String(saved.atrBinding.source),
      sourceBarAt: String(saved.atrBinding.sourceBarAt || ""),
      capturedAt: String(saved.atrBinding.capturedAt || "")
    };
  } else {
    els.positionAtr.value = "";
    resetPositionAtrBinding();
  }
}

function riskInput() {
  return {
    ema1h: els.ema1h.value,
    rsi1h: els.rsi1h.value,
    atrPercentile: els.atrPercentile.value,
    enteredAt: els.enteredAt.value,
    noFavorableExcursion: els.noFavorableExcursion.checked,
    stopHesitation: els.stopHesitation.checked
  };
}

function setRiskCard(element, tone, title, description) {
  element.className = `risk-card ${tone}`;
  element.querySelector("strong").textContent = title;
  element.querySelector("p").textContent = description;
}

function renderRisk() {
  const input = riskInput();
  writeJson(RISK_KEY, {
    ema1h: input.ema1h, rsi1h: input.rsi1h, atrPercentile: input.atrPercentile,
    noFavorableExcursion: input.noFavorableExcursion, stopHesitation: input.stopHesitation
  });
  const result = classifyPatternRisk(input);

  if (!result.p6Complete) {
    setRiskCard(els.p6Result, "caution", "판단 보류", "ATR% 백분위와 1h EMA/RSI 정보가 필요합니다.");
  } else if (result.p6Forbidden) {
    setRiskCard(els.p6Result, "caution", "P6 shadow 경고 후보", "High Vol(≥75백분위) AND Bearish Regime이 모두 탐지됐지만 검증 표본이 각 1건이라 자동 차단하지 않습니다.");
  } else {
    setRiskCard(els.p6Result, "safe", "P6 본 규칙 미해당", "AND 조건은 완성되지 않았습니다. P1–P5 적합성까지 의미하지는 않습니다.");
  }
  if (!result.killComplete) {
    setRiskCard(els.killResult, "caution", "판단 보류 · 비활성", "비교용 OR 규칙의 감지 여부를 보려면 나머지 환경 정보가 필요합니다. hard kill로는 사용하지 않습니다.");
  } else if (result.globalKillSwitch) {
    setRiskCard(els.killResult, "caution", "기존 OR 규칙 감지 · 비활성", "EMA 약세, RSI<45, High Vol 중 하나 이상이지만 실증상 과잉차단이어서 hard kill로 사용하지 않습니다.");
  } else {
    setRiskCard(els.killResult, "safe", "기존 OR 규칙 미감지 · 비활성", "입력된 세 조건 중 감지 조건이 없습니다. 이 규칙은 어느 경우에도 hard kill로 사용하지 않습니다.");
  }
  if (!result.p7Complete) {
    setRiskCard(els.p7Result, "caution", "진입 시각 필요 · 미검증", "포지션의 진입 시각을 입력하면 사용자 입력으로 10분 안전 알림을 점검합니다.");
  } else if (result.p7Forbidden) {
    setRiskCard(els.p7Result, "caution", "P7 입력 기반 안전 알림 · 미검증", `${Math.floor(result.holdingMinutes)}분 보유·무반응·손절 주저가 모두 입력됐습니다. 직접 관리 로그가 부족하므로 자동 판정이 아니며, 미리 정한 청산 규칙을 다시 확인하세요.`);
  } else {
    setRiskCard(els.p7Result, "safe", "P7 미검증 알림 조건 미완성", `${Math.floor(result.holdingMinutes)}분 보유. 10분·무반응·손절 주저가 모두 필요합니다.`);
  }
}

function restoreRisk() {
  const saved = readJson(RISK_KEY, {});
  els.ema1h.value = ["bullish", "bearish"].includes(saved.ema1h) ? saved.ema1h : "unknown";
  els.rsi1h.value = saved.rsi1h ?? "";
  els.atrPercentile.value = saved.atrPercentile ?? "";
  els.noFavorableExcursion.checked = Boolean(saved.noFavorableExcursion);
  els.stopHesitation.checked = Boolean(saved.stopHesitation);
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
els.positionForm.addEventListener("input", event => {
  if ([els.positionDirection, els.entryPrice, els.enteredAt].includes(event.target)) {
    els.positionAtr.value = "";
    resetPositionAtrBinding();
    capturePositionAtrFromSnapshot();
  } else if (event.target === els.positionAtr) {
    const identity = positionIdentity();
    state.positionAtrBinding = identity && isFiniteValue(els.positionAtr.value)
      ? { identity, source: "user-fixed", sourceBarAt: "", capturedAt: new Date().toISOString() }
      : { identity: "", source: "", sourceBarAt: "", capturedAt: "" };
  }
  renderPosition();
});
els.riskForm.addEventListener("input", renderRisk);
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
restoreRisk();
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
