import { validateMarketBar } from "./calculator.js";

export const LOCAL_NASDAQ_SNAPSHOT_URL = "./data/local-nasdaq-snapshot.json";
export const LOCAL_NASDAQ_SCHEMA_VERSION = 1;
export const LOCAL_NASDAQ_TIER = "nq-local-archive-reference";

function invalidLocalSnapshot(message) {
  const error = new Error(message);
  Object.defineProperty(error, "metadata", {
    value: Object.freeze({ code: "invalid-local-archive" }),
    enumerable: true
  });
  return error;
}

function validDate(value) {
  const parsed = new Date(value || "");
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function validateLocalNasdaqSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      snapshot.schemaVersion !== LOCAL_NASDAQ_SCHEMA_VERSION ||
      snapshot.mode !== "local-archive") {
    throw invalidLocalSnapshot("로컬 나스닥 스냅샷의 버전 또는 모드가 올바르지 않습니다.");
  }

  const provider = snapshot.provider || {};
  if (provider.requestedSymbol !== "NQ=F" || provider.returnedSymbol !== "NQ=F" ||
      provider.tier !== LOCAL_NASDAQ_TIER || provider.localArchive !== true ||
      provider.sourceFile !== "nasdaq_5m.csv" ||
      !/^[a-f0-9]{64}$/.test(String(provider.sourceSha256 || ""))) {
    throw invalidLocalSnapshot("로컬 나스닥 스냅샷의 출처가 승인된 NQ 보관 파일과 일치하지 않습니다.");
  }

  const generatedAt = validDate(snapshot.generatedAt);
  const sourceAt = validDate(snapshot.market?.latestBarAt);
  const start = validDate(snapshot.session?.start);
  const end = validDate(snapshot.session?.end);
  const observed = validDate(snapshot.session?.lastObservedAt);
  if (!generatedAt || !sourceAt || !start || !end || !observed ||
      snapshot.session?.timeZone !== "America/Chicago" ||
      snapshot.session?.status !== "completed" ||
      snapshot.session?.terminalCoverageVerified !== true ||
      start.getTime() >= end.getTime() ||
      sourceAt.getTime() !== observed.getTime() ||
      sourceAt.getTime() < start.getTime() || sourceAt.getTime() >= end.getTime() ||
      sourceAt.getTime() < end.getTime() - 5 * 60_000 ||
      generatedAt.getTime() < sourceAt.getTime()) {
    throw invalidLocalSnapshot("로컬 나스닥 스냅샷의 세션 또는 원천시각 검증에 실패했습니다.");
  }

  const market = validateMarketBar(snapshot.market);
  if (!market.valid) {
    throw invalidLocalSnapshot(`로컬 나스닥 가격 검증에 실패했습니다. ${market.errors.join(" ")}`);
  }
  return snapshot;
}

export async function fetchLocalNasdaqSnapshot(fetchImpl = fetch, options = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch 구현이 필요합니다.");
  const response = await fetchImpl(options.url || LOCAL_NASDAQ_SNAPSHOT_URL, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  if (!response?.ok || response.status !== 200) {
    throw invalidLocalSnapshot("동기화된 로컬 나스닥 참고 파일을 불러오지 못했습니다.");
  }
  const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw invalidLocalSnapshot("로컬 나스닥 참고 파일이 JSON으로 제공되지 않았습니다.");
  }
  let snapshot;
  try {
    snapshot = await response.json();
  } catch {
    throw invalidLocalSnapshot("로컬 나스닥 참고 파일의 JSON 형식이 올바르지 않습니다.");
  }
  return validateLocalNasdaqSnapshot(snapshot);
}

export function shouldPreferLocalArchive(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal")
    .map(part => [part.type, part.value]));
  const hour = Number(values.hour);
  return values.weekday === "Sat" ||
    (values.weekday === "Fri" && hour >= 16) ||
    (values.weekday === "Sun" && hour < 17);
}
