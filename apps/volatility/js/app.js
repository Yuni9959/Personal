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
  REQUEST_COOLDOWN_MS,
  REQUEST_DEADLINE_MS,
  calculateCooldown,
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
const LEGACY_MANUAL_KEY = "personal-tap-volatility-manual-v1";
const POSITION_KEY = "personal-tap-volatility-position-v1";
const RISK_KEY = "personal-tap-volatility-risk-v1";

const $ = selector => document.querySelector(selector);
const els = {
  dataStatus: $("#dataStatus"), dataNotice: $("#dataNotice"), refreshBtn: $("#refreshBtn"),
  manualToggleBtn: $("#manualToggleBtn"), manualPanel: $("#manualPanel"), manualError: $("#manualError"),
  openPrice: $("#openPrice"), highPrice: $("#highPrice"), lowPrice: $("#lowPrice"),
  currentPrice: $("#currentPrice"), atrValue: $("#atrValue"), symbolLabel: $("#symbolLabel"),
  barUpdateText: $("#barUpdateText"), lastUpdateText: $("#lastUpdateText"), delayText: $("#delayText"),
  automaticCalculations: $("#automaticCalculations"), calculationLock: $("#calculationLock"),
  bullMeanReference: $("#bullMeanReference"), bullSafeReference: $("#bullSafeReference"),
  bearMeanReference: $("#bearMeanReference"), bearSafeReference: $("#bearSafeReference"),
  referencePeriod: $("#referencePeriod"),
  operationalUpPercent: $("#operationalUpPercent"), operationalDownPercent: $("#operationalDownPercent"),
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
  return assessment.usable ? `${age} · 약 10분 지연 참고` : `${age} · 계산 중지`;
}

function setStatus(snapshot, assessment = assessSnapshot(snapshot)) {
  const isActiveManual = snapshot?.mode === "manual" && assessment.usable;
  els.dataStatus.dataset.state = assessment.key;
  const age = assessment.ageMinutes === null ? "" : ` · ${Math.max(0, Math.round(assessment.ageMinutes))}분 전 가격`;
  els.dataStatus.textContent = isActiveManual
    ? "수동 입력"
    : assessment.usable
      ? `요청 시 지연 시세${age}`
      : `이전 데이터 · 계산 중지${age}`;
  els.dataNotice.className = "notice";
  if (isActiveManual) {
    els.dataNotice.textContent = "수동 입력값으로 계산 중입니다. 주문 전 실제 월물 시세와 다시 대조하세요.";
  } else if (!assessment.usable) {
    els.dataNotice.classList.add(assessment.key === "error" ? "error" : "warning");
    els.dataNotice.textContent = `${assessment.reason} 표시된 값은 이전 참고값이며 시나리오·포지션 계산에는 사용하지 않습니다.`;
  } else {
    els.dataNotice.textContent = "사용자가 요청할 때만 조회한 Yahoo 약 10분 지연 MNQ 연속선물 프록시입니다. 실제 월물·증권사 시세와 확인한 후에만 사용하세요.";
  }
  if (state.transientNotice) els.dataNotice.textContent += ` ${state.transientNotice}`;
}

function clearManualQuoteInputs() {
  for (const input of [els.manualOpen, els.manualHigh, els.manualLow, els.manualCurrent, els.manualAtr]) {
    input.value = "";
  }
  els.manualConfirm.checked = false;
}

function formatPercent(value, digits = 3) {
  return value !== null && value !== "" && Number.isFinite(Number(value))
    ? `${Number(value).toFixed(digits)}%`
    : "—";
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
  if (!state.snapshot || !state.assessment?.usable) return;
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
    ? { ...currentAssessment, usable: false, key: "stale", reason: state.forceLockReason }
    : currentAssessment;
  state.assessment = assessment;
  state.calculationAllowed = assessment.usable;
  setStatus(state.snapshot, assessment);
  els.openPrice.textContent = formatNumber(market.open);
  els.highPrice.textContent = formatNumber(market.high);
  els.lowPrice.textContent = formatNumber(market.low);
  els.currentPrice.textContent = formatNumber(market.current);
  els.atrValue.textContent = assessment.usable ? formatNumber(market.atr5m14, " pt") : "—";
  els.symbolLabel.textContent = `${providerDescription(state.snapshot)} · ${state.snapshot.session?.label || "수동 세션"}`;
  els.barUpdateText.textContent = formatDate(market.latestBarAt);
  els.lastUpdateText.textContent = formatDate(state.snapshot.generatedAt);
  els.delayText.textContent = delayDescription(state.snapshot, assessment);

  if (!assessment.usable) {
    state.scenarios = null;
    state.operational = null;
    state.autoAtr = null;
    clearExpiryTimer();
    clearManualQuoteInputs();
    els.useAutoAtrBtn.disabled = true;
    setCalculationLock(true, assessment.reason);
    els.manualPanel.hidden = false;
    els.manualToggleBtn.setAttribute("aria-expanded", "true");
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
    ? { ...assessment, usable: false, key: "stale", reason: forceLockReason }
    : assessment;
  if (cache && state.assessment.usable && snapshot.mode !== "manual") {
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
  state.forceLockReason = "";
  clearManualQuoteInputs();
  els.useAutoAtrBtn.disabled = true;
  state.autoAtr = null;
  els.dataStatus.dataset.state = "error";
  els.dataStatus.textContent = "지연 시세 없음 · 계산 중지";
  els.dataNotice.className = "notice error";
  els.dataNotice.textContent = message;
  els.delayText.textContent = "조회 실패 · 계산 중지";
  setCalculationLock(true, "검증된 MNQ 시세가 없습니다.");
  els.manualPanel.hidden = false;
  els.manualToggleBtn.setAttribute("aria-expanded", "true");
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
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = "지연 시세 확인 중…";
  state.transientNotice = "";
  const remaining = cooldownRemainingMs();
  if (remaining > 0) {
    const seconds = Math.ceil(remaining / 1000);
    state.transientNotice = `반복 요청을 줄이기 위해 ${seconds}초 후 다시 확인할 수 있습니다.`;
    // Re-evaluate the source timestamp before reusing any visible calculation.
    // A wall-clock jump or an expiry boundary must lock immediately instead of
    // waiting for the next scheduled freshness check.
    if (state.snapshot) renderMarket();
    if (state.assessment?.usable) {
      setStatus(state.snapshot, state.assessment);
    } else {
      await showLockedFallback(`60초 중복 조회 방지 대기 중입니다. ${seconds}초 후 다시 확인하세요.`);
    }
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "요청 시 지연 시세 확인";
    document.body.dataset.ready = "true";
    return;
  }

  state.lastRequestAt = Date.now();
  writeJson(LAST_REQUEST_KEY, state.lastRequestAt);
  try {
    const snapshot = validateSnapshot(await fetchYahooSnapshot(fetch, new Date(), {
      timeoutMs: REQUEST_DEADLINE_MS
    }));
    const assessment = assessSnapshot(snapshot);
    state.transientNotice = trigger === "load"
      ? "이 화면을 열어 한 번 조회했습니다. 백그라운드 갱신은 없습니다."
      : "버튼 요청으로 한 번 조회했습니다. 백그라운드 갱신은 없습니다.";
    applySnapshot(snapshot, { cache: assessment.usable });
  } catch {
    // Manual input may remain usable after a network failure, but its 25-minute
    // freshness contract is checked again at the exact failure boundary.
    if (state.snapshot?.mode === "manual") renderMarket();
    if (state.snapshot?.mode === "manual" && state.assessment?.usable) {
      state.transientNotice = "지연 시세 요청이 네트워크·CORS·호출 제한으로 실패해 수동 확인값을 유지합니다.";
      setStatus(state.snapshot, state.assessment);
    } else {
      await showLockedFallback("새 Yahoo 지연 시세 요청이 실패했습니다. 이전 값으로 자동 계산하지 않습니다.");
    }
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "요청 시 지연 시세 확인";
    document.body.dataset.ready = "true";
  }
}

async function refreshMarket(options = {}) {
  const result = await withExclusiveRequest(() => refreshMarketUnlocked(options));
  if (result.acquired) return result.value;
  state.transientNotice = "다른 탭에서 이미 시세를 확인 중입니다. 중복 요청을 보내지 않았습니다.";
  if (state.snapshot) renderMarket();
  else showNoUsableSnapshot("다른 탭에서 시세를 확인 중입니다. 잠시 후 다시 눌러 주세요.");
  els.refreshBtn.disabled = false;
  els.refreshBtn.textContent = "요청 시 지연 시세 확인";
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
    els.positionEmpty.textContent = state.snapshot
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

els.manualToggleBtn.addEventListener("click", () => {
  const expanded = els.manualToggleBtn.getAttribute("aria-expanded") === "true";
  els.manualToggleBtn.setAttribute("aria-expanded", String(!expanded));
  els.manualPanel.hidden = expanded;
});

els.manualPanel.addEventListener("submit", event => {
  event.preventDefault();
  if (!els.manualConfirm.checked) {
    els.manualError.textContent = "실제 MNQ 월물 값을 방금 직접 확인했다는 항목에 체크해야 합니다.";
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
renderRisk();
refreshMarket({ trigger: "load" });
