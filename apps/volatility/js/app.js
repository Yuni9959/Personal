import {
  WEEKLY_VOLATILITY_REFERENCE as REFERENCE,
  calculatePositionScenario,
  calculateVolatilityScenario,
  classifyPatternRisk,
  classifySnapshotStatus,
  validateMarketBar
} from "./calculator.js";
import { fetchYahooSnapshot } from "./market-provider.js";

const SNAPSHOT_CACHE_KEY = "personal-tap-volatility-snapshot-v1";
const MANUAL_KEY = "personal-tap-volatility-manual-v1";
const POSITION_KEY = "personal-tap-volatility-position-v1";
const RISK_KEY = "personal-tap-volatility-risk-v1";

const $ = selector => document.querySelector(selector);
const els = {
  dataStatus: $("#dataStatus"), dataNotice: $("#dataNotice"), refreshBtn: $("#refreshBtn"),
  manualToggleBtn: $("#manualToggleBtn"), manualPanel: $("#manualPanel"), manualError: $("#manualError"),
  openPrice: $("#openPrice"), highPrice: $("#highPrice"), lowPrice: $("#lowPrice"),
  currentPrice: $("#currentPrice"), atrValue: $("#atrValue"), symbolLabel: $("#symbolLabel"),
  barUpdateText: $("#barUpdateText"), lastUpdateText: $("#lastUpdateText"),
  bullReference: $("#bullReference"), bearReference: $("#bearReference"), referencePeriod: $("#referencePeriod"),
  manualOpen: $("#manualOpen"), manualHigh: $("#manualHigh"), manualLow: $("#manualLow"),
  manualCurrent: $("#manualCurrent"), manualAtr: $("#manualAtr"), useAutoAtrBtn: $("#useAutoAtrBtn"),
  positionForm: $("#positionForm"), positionDirection: $("#positionDirection"), entryPrice: $("#entryPrice"),
  quantity: $("#quantity"), fees: $("#fees"), positionAtr: $("#positionAtr"), enteredAt: $("#enteredAt"),
  positionEmpty: $("#positionEmpty"), positionResults: $("#positionResults"),
  positionSummary: $("#positionSummary"), positionScenarioGrid: $("#positionScenarioGrid"),
  riskForm: $("#riskForm"), ema1h: $("#ema1h"), rsi1h: $("#rsi1h"),
  atrPercentile: $("#atrPercentile"), noFavorableExcursion: $("#noFavorableExcursion"),
  stopHesitation: $("#stopHesitation"), p6Result: $("#p6Result"), killResult: $("#killResult"), p7Result: $("#p7Result")
};

const scenarioEls = {
  bull: { budget: $("#bullBudget"), used: $("#bullUsed"), remaining: $("#bullRemaining"), bounds: $("#bullBounds"), progress: $("#bullProgress") },
  bear: { budget: $("#bearBudget"), used: $("#bearUsed"), remaining: $("#bearRemaining"), bounds: $("#bearBounds"), progress: $("#bearProgress") }
};

const state = { snapshot: null, scenarios: null, autoAtr: null, transientNotice: "" };
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
  return Number.isFinite(Number(value)) ? `${numberFormat.format(Number(value))}${suffix}` : "—";
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

function setStatus(snapshot) {
  const status = classifySnapshotStatus(snapshot);
  els.dataStatus.dataset.state = status.key;
  const age = status.ageMinutes === null ? "" : ` · ${Math.round(status.ageMinutes)}분 전`;
  els.dataStatus.textContent = `${status.label}${age}`;
  els.dataNotice.className = "notice";
  if (status.key === "manual") {
    els.dataNotice.textContent = "수동 입력값으로 계산 중입니다. 주문 전 실제 월물 시세와 다시 대조하세요.";
  } else if (["aging", "stale", "error"].includes(status.key)) {
    els.dataNotice.classList.add(status.key === "error" ? "error" : "warning");
    els.dataNotice.textContent = status.key === "error"
      ? "유효한 시세가 없습니다. 수동 시세를 입력해야 계산할 수 있습니다."
      : "스냅샷이 오래됐습니다. 자동 새로고침을 시도하거나 증권사의 오늘 O/H/L/현재가를 수동으로 입력하세요.";
  } else {
    els.dataNotice.textContent = "지연될 수 있는 연속선물 프록시입니다. 실제 월물·증권사 시세와 확인한 후에만 사용하세요.";
  }
  if (state.transientNotice) els.dataNotice.textContent += ` ${state.transientNotice}`;
}

function populateManual(market) {
  if (!market) return;
  els.manualOpen.value = market.open ?? "";
  els.manualHigh.value = market.high ?? "";
  els.manualLow.value = market.low ?? "";
  els.manualCurrent.value = market.current ?? "";
  els.manualAtr.value = market.atr5m14 ?? "";
}

function renderScenario(kind, scenario, current) {
  const target = scenarioEls[kind];
  target.budget.textContent = formatNumber(scenario.budgetPoints, " pt");
  target.used.textContent = `${formatNumber(scenario.usedPoints, " pt")} · ${formatNumber(scenario.usedPercent, "%")}`;
  target.remaining.textContent = scenario.exhausted ? "0.00 pt · 기준 초과" : formatNumber(scenario.remainingPoints, " pt");
  target.bounds.textContent = `▲ ${formatNumber(scenario.favorableBoundary.long)} / ▼ ${formatNumber(scenario.favorableBoundary.short)}`;
  target.progress.style.width = `${Math.min(100, Math.max(0, scenario.usedPercent))}%`;
  target.progress.parentElement.title = `소진률 ${formatNumber(scenario.usedPercent, "%")} · 현재가 ${formatNumber(current)}`;
}

function renderMarket() {
  if (!state.snapshot) return;
  const market = state.snapshot.market;
  setStatus(state.snapshot);
  els.openPrice.textContent = formatNumber(market.open);
  els.highPrice.textContent = formatNumber(market.high);
  els.lowPrice.textContent = formatNumber(market.low);
  els.currentPrice.textContent = formatNumber(market.current);
  els.atrValue.textContent = formatNumber(market.atr5m14, " pt");
  const symbol = state.snapshot.provider?.returnedSymbol || state.snapshot.provider?.requestedSymbol || "MNQ 수동";
  els.symbolLabel.textContent = `${symbol} · ${state.snapshot.session?.label || "수동 세션"}`;
  els.barUpdateText.textContent = formatDate(market.latestBarAt);
  els.lastUpdateText.textContent = formatDate(state.snapshot.generatedAt);

  state.scenarios = {
    bull: calculateVolatilityScenario(market, REFERENCE.bullPercent),
    bear: calculateVolatilityScenario(market, REFERENCE.bearPercent)
  };
  renderScenario("bull", state.scenarios.bull, market.current);
  renderScenario("bear", state.scenarios.bear, market.current);
  if (state.snapshot.mode !== "manual") state.autoAtr = market.atr5m14;
  if (!els.positionAtr.value && Number.isFinite(Number(state.autoAtr))) {
    els.positionAtr.value = state.autoAtr;
  }
  populateManual(market);
  renderPosition();
}

function applySnapshot(snapshot, { cache = true } = {}) {
  state.snapshot = validateSnapshot(snapshot);
  if (cache && snapshot.mode !== "manual") writeJson(SNAPSHOT_CACHE_KEY, snapshot);
  renderMarket();
}

async function fetchStaticSnapshot() {
  const response = await fetch(`./data/market.json?at=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`저장된 스냅샷 HTTP ${response.status}`);
  return validateSnapshot(await response.json());
}

async function refreshMarket({ tryDirectWhenStale = false } = {}) {
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = "시세 확인 중…";
  state.transientNotice = "";
  let snapshot = null;
  let staticError = null;
  try {
    snapshot = await fetchStaticSnapshot();
  } catch (error) {
    staticError = error;
    snapshot = readJson(SNAPSHOT_CACHE_KEY);
    if (snapshot) state.transientNotice = "온라인 스냅샷 대신 이 기기의 마지막 자동 시세를 사용합니다.";
  }

  const shouldTryDirect = !snapshot ||
    (tryDirectWhenStale && ["aging", "stale", "error"].includes(classifySnapshotStatus(snapshot).key));
  if (shouldTryDirect) {
    try {
      snapshot = await fetchYahooSnapshot();
      state.transientNotice = "브라우저 직접 조회가 성공했습니다.";
    } catch (error) {
      const prefix = staticError ? `${staticError.message}; ` : "";
      state.transientNotice = `${prefix}직접 조회도 CORS·호출 제한으로 실패했습니다. 수동 입력을 사용하세요.`;
    }
  }

  if (snapshot) {
    try { applySnapshot(snapshot); }
    catch (error) { state.transientNotice = `스냅샷 검증 실패: ${error.message}`; }
  }
  if (!state.snapshot) {
    els.dataStatus.dataset.state = "error";
    els.dataStatus.textContent = "시세 없음";
    els.dataNotice.className = "notice error";
    els.dataNotice.textContent = state.transientNotice || "자동 시세를 가져오지 못했습니다. 수동 입력을 사용하세요.";
    els.manualPanel.hidden = false;
    els.manualToggleBtn.setAttribute("aria-expanded", "true");
  } else {
    setStatus(state.snapshot);
  }
  els.refreshBtn.disabled = false;
  els.refreshBtn.textContent = "자동 시세 새로고침";
  document.body.dataset.ready = "true";
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
  writeJson(POSITION_KEY, input);
  if (!state.snapshot || !state.scenarios || input.direction === "none") {
    els.positionEmpty.hidden = false;
    els.positionEmpty.textContent = POSITION_EMPTY_MESSAGE;
    els.positionResults.hidden = true;
    renderRisk();
    return;
  }
  try {
    const bull = calculatePositionScenario(input, state.snapshot.market, state.scenarios.bull);
    const bear = calculatePositionScenario(input, state.snapshot.market, state.scenarios.bear);
    els.positionSummary.innerHTML = `
      <article><span>현재 순손익 가정</span><strong class="${moneyClass(bull.currentNetUsd)}">${moneyFormat.format(bull.currentNetUsd)}</strong></article>
      <article><span>1.0×5분 ATR 고정 손절선</span><strong>${formatNumber(bull.stopPrice)}</strong></article>
      <article><span>손절 체결 시 순손익 가정</span><strong class="${moneyClass(bull.stopNetUsd)}">${moneyFormat.format(bull.stopNetUsd)}</strong></article>`;
    els.positionScenarioGrid.innerHTML = [
      ["양봉일 시나리오", bull],
      ["음봉일 시나리오", bear]
    ].map(([title, result]) => `
      <article>
        <h3>${title}</h3>
        <p><span>유리 방향 상한 가정가</span><strong>${formatNumber(result.favorableBoundary)}</strong></p>
        <p><span>현재가 이후 추가 총이익 상한 (비용 미차감)</span><strong class="${moneyClass(result.incrementalGrossUsd)}">${moneyFormat.format(result.incrementalGrossUsd)}</strong></p>
        <p><span>진입가부터 순손익 가정</span><strong class="${moneyClass(result.projectedNetUsd)}">${moneyFormat.format(result.projectedNetUsd)}</strong></p>
        <p><span>남은 유리 범위</span><strong>${formatNumber(result.incrementalPoints, " pt")}</strong></p>
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
  els.positionAtr.value = saved.atr5m14 ?? "";
  els.enteredAt.value = saved.enteredAt ?? "";
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
  const manual = {
    schemaVersion: 1, mode: "manual", generatedAt: new Date().toISOString(),
    provider: { name: "사용자 수동 입력", requestedSymbol: "MNQ", returnedSymbol: "MNQ 수동" },
    session: { label: "사용자 확인 세션", timeZone: "Asia/Seoul" },
    market: { ...validation.values, latestBarAt: new Date().toISOString() }
  };
  writeJson(MANUAL_KEY, manual);
  state.transientNotice = "";
  applySnapshot(manual, { cache: false });
});

els.useAutoAtrBtn.addEventListener("click", () => {
  if (Number.isFinite(Number(state.autoAtr))) els.manualAtr.value = state.autoAtr;
});
els.refreshBtn.addEventListener("click", () => refreshMarket({ tryDirectWhenStale: true }));
els.positionForm.addEventListener("input", renderPosition);
els.riskForm.addEventListener("input", renderRisk);

els.bullReference.textContent = `${REFERENCE.bullPercent.toFixed(3)}%`;
els.bearReference.textContent = `${REFERENCE.bearPercent.toFixed(3)}%`;
els.referencePeriod.textContent = `${REFERENCE.effectiveFrom} ~ ${REFERENCE.effectiveThrough} · 계산 ${REFERENCE.calculatedAt} · ${REFERENCE.sourceSymbol}`;
const todayKst = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());
if (todayKst > REFERENCE.effectiveThrough) {
  els.referencePeriod.textContent += " · 기준 만료—월요일 갱신 필요";
  els.referencePeriod.style.color = "var(--amber)";
}
restorePosition();
restoreRisk();
const savedManual = readJson(MANUAL_KEY);
if (savedManual?.market) populateManual(savedManual.market);
renderRisk();
refreshMarket();
window.setInterval(renderRisk, 60000);
