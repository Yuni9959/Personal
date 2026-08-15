const CHICAGO_TIME_ZONE = "America/Chicago";
const YAHOO_ACCEPTED_TIME_ZONES = new Set(["America/Chicago", "America/New_York"]);
const YAHOO_HOST = "query2.finance.yahoo.com";
const JINA_READER_ORIGIN = "https://r.jina.ai";
const PRIMARY_SYMBOL = "MNQ=F";
const CME_DELAY_MINUTES = 10;
const CME_EQUITY_TICK = 0.25;
const BAR_SECONDS = 5 * 60;
// Five calendar days keeps the most recent completed CME session available
// across ordinary weekends and three-day holiday weekends. The response is
// still bounded independently before either JSON layer is parsed.
const SOURCE_LOOKBACK_SECONDS = 5 * 24 * 60 * 60;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 15000;
export const MAX_JSON_RESPONSE_BYTES = 512 * 1024;

function abortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function providerError(message, { metadata = null } = {}) {
  const error = new Error(message);
  if (metadata && typeof metadata === "object") {
    Object.defineProperty(error, "metadata", {
      value: Object.freeze({ ...metadata }),
      enumerable: true
    });
  }
  return error;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function normalizeTimeout(timeoutMs) {
  const value = Number(timeoutMs);
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("시세 요청 제한시간은 0보다 큰 밀리초여야 합니다.");
  }
  return Math.min(value, MAX_TIMEOUT_MS);
}

function createRequestContext(externalSignal, timeoutMs) {
  if (externalSignal !== undefined &&
      (typeof externalSignal !== "object" || typeof externalSignal.addEventListener !== "function")) {
    throw new TypeError("signal은 AbortSignal이어야 합니다.");
  }

  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort(externalSignal.reason || abortError("시세 요청이 취소되었습니다."));

  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(abortError(`시세 요청이 총 ${timeoutMs}ms 제한시간을 초과했습니다.`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup() {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  };
}

async function withRequestTimeout(operation, externalSignal, timeoutMs) {
  const context = createRequestContext(externalSignal, timeoutMs);
  let removeAbortListener = () => {};
  try {
    if (context.signal.aborted) throw context.signal.reason || abortError("시세 요청이 취소되었습니다.");
    const abortPromise = new Promise((_, reject) => {
      const onAbort = () => reject(context.signal.reason || abortError("시세 요청이 취소되었습니다."));
      context.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => context.signal.removeEventListener("abort", onAbort);
    });
    const operationPromise = Promise.resolve().then(() => operation(context.signal));
    return await Promise.race([operationPromise, abortPromise]);
  } catch (error) {
    if (context.didTimeOut()) throw abortError(`시세 요청이 총 ${timeoutMs}ms 제한시간을 초과했습니다.`);
    if (externalSignal?.aborted || isAbortError(error)) throw abortError("시세 요청이 취소되었습니다.");
    throw error;
  } finally {
    removeAbortListener();
    context.cleanup();
  }
}

function headerValue(response, name) {
  try {
    const value = response?.headers?.get?.(name);
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function parseRetryAfter(value, referenceDate) {
  const raw = String(value || "").trim();
  if (!raw) return { seconds: null, retryAt: null };
  const referenceMs = referenceDate instanceof Date && Number.isFinite(referenceDate.getTime())
    ? referenceDate.getTime()
    : Date.now();

  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isSafeInteger(seconds)) return { seconds: null, retryAt: null };
    const retryAtMs = referenceMs + seconds * 1000;
    const retryAt = new Date(retryAtMs);
    return Number.isFinite(retryAt.getTime())
      ? { seconds, retryAt: retryAt.toISOString() }
      : { seconds: null, retryAt: null };
  }

  const retryAtMs = Date.parse(raw);
  if (!Number.isFinite(retryAtMs)) return { seconds: null, retryAt: null };
  const seconds = Math.max(0, Math.ceil((retryAtMs - referenceMs) / 1000));
  return Number.isSafeInteger(seconds)
    ? { seconds, retryAt: new Date(retryAtMs).toISOString() }
    : { seconds: null, retryAt: null };
}

function responseTooLargeError({ declaredBytes = null, observedBytes = null } = {}) {
  return providerError(
    `시세 JSON 응답이 ${MAX_JSON_RESPONSE_BYTES}바이트 안전 상한을 초과해 차단됐습니다.`,
    {
      metadata: {
        code: "response-too-large",
        maxResponseBytes: MAX_JSON_RESPONSE_BYTES,
        declaredBytes,
        observedBytes
      }
    }
  );
}

function validateJsonResponse(response, referenceDate) {
  if (!response || typeof response !== "object") throw new Error("시세 서버가 응답 객체를 반환하지 않았습니다.");
  if (!response.ok) {
    const status = Number(response.status);
    if (status === 429) {
      const retry = parseRetryAfter(headerValue(response, "retry-after"), referenceDate);
      const guidance = retry.seconds === null
        ? "잠시 후 사용자가 다시 요청해 주세요."
        : `${retry.seconds}초 후 사용자가 다시 요청해 주세요.`;
      throw providerError(`HTTP 429 · 시세 중계 요청이 제한됐습니다. ${guidance} 자동 재시도하지 않습니다.`, {
        metadata: {
          code: "rate-limited",
          status: 429,
          retryAfterSeconds: retry.seconds,
          retryAt: retry.retryAt,
          automaticRetry: false
        }
      });
    }
    throw providerError(`HTTP ${status || "오류"}`, {
      metadata: { code: "http-error", status: Number.isFinite(status) ? status : null }
    });
  }
  const contentType = headerValue(response, "content-type");
  if (!/(?:application|text)\/(?:[\w.+-]*\+)?json\b/i.test(contentType)) {
    throw providerError("JSON이 아닌 응답이어서 차단됐습니다.", {
      metadata: { code: "invalid-content-type" }
    });
  }
  const contentLength = headerValue(response, "content-length");
  if (contentLength) {
    if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(Number(contentLength))) {
      throw providerError("시세 응답 Content-Length가 올바르지 않아 차단됐습니다.", {
        metadata: { code: "invalid-content-length" }
      });
    }
    const declaredBytes = Number(contentLength);
    if (declaredBytes > MAX_JSON_RESPONSE_BYTES) throw responseTooLargeError({ declaredBytes });
  }
  if (!response.body?.getReader && typeof response.text !== "function") {
    throw new Error("시세 응답 본문 크기를 검증하며 읽을 수 없습니다.");
  }
}

async function readBoundedJson(response) {
  let text;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let observedBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) {
          throw providerError("시세 응답 본문 형식이 올바르지 않습니다.", {
            metadata: { code: "invalid-body-chunk" }
          });
        }
        observedBytes += value.byteLength;
        if (observedBytes > MAX_JSON_RESPONSE_BYTES) {
          try { await reader.cancel(); }
          catch { /* The body is already rejected; cancellation is best-effort. */ }
          throw responseTooLargeError({ observedBytes });
        }
        chunks.push(value);
      }
    } catch (error) {
      if (isAbortError(error) || error?.metadata) throw error;
      throw providerError("시세 응답 본문을 안전하게 읽지 못했습니다.", {
        metadata: { code: "body-read-failed" }
      });
    } finally {
      try { reader.releaseLock?.(); }
      catch { /* The body is already consumed or rejected. */ }
    }
    const bytes = new Uint8Array(observedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw providerError("시세 응답이 올바른 UTF-8 JSON이 아닙니다.", {
        metadata: { code: "invalid-json-encoding" }
      });
    }
  } else {
    let candidate;
    try {
      candidate = await response.text();
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw providerError("시세 응답 본문을 안전하게 읽지 못했습니다.", {
        metadata: { code: "body-read-failed" }
      });
    }
    if (typeof candidate !== "string") {
      throw providerError("시세 응답 본문 형식이 올바르지 않습니다.", {
        metadata: { code: "invalid-body-text" }
      });
    }
    const observedBytes = new TextEncoder().encode(candidate).byteLength;
    if (observedBytes > MAX_JSON_RESPONSE_BYTES) throw responseTooLargeError({ observedBytes });
    text = candidate;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw providerError("시세 응답 JSON 형식이 올바르지 않습니다.", {
      metadata: { code: "invalid-json" }
    });
  }
}

function buildYahooSourceUrl(fetchedAt) {
  const period2 = Math.floor(fetchedAt.getTime() / 60000) * 60;
  const period1 = period2 - SOURCE_LOOKBACK_SECONDS;
  const url = new URL(`https://${YAHOO_HOST}/v8/finance/chart/${PRIMARY_SYMBOL}`);
  url.searchParams.set("interval", "5m");
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("includePrePost", "true");
  url.searchParams.set("events", "div,splits");
  return url;
}

function comparableSourceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw providerError("Jina Reader 원본 URL이 올바르지 않습니다.", {
      metadata: { code: "invalid-reader-source-url" }
    });
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw providerError("Jina Reader 원본 URL의 보안 경계가 올바르지 않습니다.", {
      metadata: { code: "invalid-reader-source-url" }
    });
  }

  const entries = [...url.searchParams.entries()]
    .map(([key, item]) => [key, item])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  return {
    origin: url.origin,
    pathname: url.pathname,
    entries,
    canonical: `${url.origin}${url.pathname}?${entries
      .map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`)
      .join("&")}`
  };
}

function parseReaderEnvelope(envelope, expectedSourceUrl) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
      envelope.code !== 200 || envelope.status !== 200 ||
      !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    throw providerError("Jina Reader JSON envelope 검증에 실패했습니다.", {
      metadata: { code: "invalid-reader-envelope" }
    });
  }
  if (Object.hasOwn(envelope.data, "httpStatus") && envelope.data.httpStatus !== 200) {
    throw providerError("Jina Reader 원본 시세 응답 상태가 200이 아닙니다.", {
      metadata: { code: "invalid-reader-source-status" }
    });
  }
  if (typeof envelope.data.url !== "string" || typeof envelope.data.content !== "string") {
    throw providerError("Jina Reader 원본 URL 또는 content가 올바르지 않습니다.", {
      metadata: { code: "invalid-reader-envelope" }
    });
  }

  const actual = comparableSourceUrl(envelope.data.url);
  const expected = comparableSourceUrl(expectedSourceUrl.href);
  if (actual.canonical !== expected.canonical) {
    throw providerError("Jina Reader가 반환한 원본 URL이 고정 MNQ 요청과 일치하지 않습니다.", {
      metadata: { code: "reader-source-url-mismatch" }
    });
  }

  const contentBytes = new TextEncoder().encode(envelope.data.content).byteLength;
  if (contentBytes > MAX_JSON_RESPONSE_BYTES) {
    throw responseTooLargeError({ observedBytes: contentBytes });
  }
  let payload;
  try {
    payload = JSON.parse(envelope.data.content);
  } catch {
    throw providerError("Jina Reader content의 Yahoo JSON 형식이 올바르지 않습니다.", {
      metadata: { code: "invalid-reader-content-json" }
    });
  }
  return { payload, sourceUrl: actual.canonical };
}

function isTickAligned(value, tick = CME_EQUITY_TICK) {
  const units = value / tick;
  return Math.abs(units - Math.round(units)) <= 1e-6;
}

function symbolTier(symbol) {
  if (symbol === PRIMARY_SYMBOL) return "mnq-continuous-proxy";
  throw new Error(`지원하지 않는 Yahoo 프록시 종목입니다: ${symbol}`);
}

function partsAt(date, timeZone = CHICAGO_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== "literal")
    .map(part => [part.type, Number(part.value)]));
}

function addCalendarDays(parts, days) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

export function zonedLocalToUtc(parts, timeZone = CHICAGO_TIME_ZONE) {
  const targetAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0
  );
  let guess = targetAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = partsAt(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const correction = targetAsUtc - actualAsUtc;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess);
}

export function cmeEquitySessionFor(date) {
  const local = partsAt(date);
  const startDate = local.hour >= 17
    ? { year: local.year, month: local.month, day: local.day }
    : addCalendarDays(local, -1);
  const endDate = addCalendarDays(startDate, 1);
  const start = zonedLocalToUtc({ ...startDate, hour: 17 });
  const end = zonedLocalToUtc({ ...endDate, hour: 16 });
  const sessionDate = [startDate.year, String(startDate.month).padStart(2, "0"),
    String(startDate.day).padStart(2, "0")].join("-");
  return { start, end, sessionDate, timeZone: CHICAGO_TIME_ZONE };
}

function finiteAt(values, index) {
  const raw = values?.[index];
  if (raw === null || raw === undefined || raw === "") return null;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : Number.NaN;
}

function validateYahooProvenance(meta) {
  if (meta.dataGranularity !== "5m") {
    throw new Error(`Yahoo 응답 봉 주기가 정확한 5m가 아닙니다: ${meta.dataGranularity || "없음"}`);
  }
  const quoteType = meta.instrumentType ?? meta.quoteType;
  if (quoteType !== "FUTURE") throw new Error(`Yahoo 응답 상품 유형이 FUTURE가 아닙니다: ${quoteType || "없음"}`);
  const exchange = String(meta.exchangeName || meta.fullExchangeName || "").trim();
  if (!/^(?:CME|CME GLOBEX|CHICAGO MERCANTILE EXCHANGE)$/i.test(exchange)) {
    throw new Error(`Yahoo 응답 거래소가 허용된 CME 계열이 아닙니다: ${exchange || "없음"}`);
  }
  if (!YAHOO_ACCEPTED_TIME_ZONES.has(meta.exchangeTimezoneName)) {
    throw new Error(`Yahoo 응답 거래소 시간대가 허용값이 아닙니다: ${meta.exchangeTimezoneName || "없음"}`);
  }
  if (meta.currency !== "USD") throw new Error(`Yahoo 응답 통화가 USD가 아닙니다: ${meta.currency || "없음"}`);
  if (!Object.hasOwn(meta, "exchangeDataDelayedBy")) {
    return { delayMinutes: null, delayMetadataVerified: false };
  }
  if (typeof meta.exchangeDataDelayedBy !== "number" ||
      !Number.isFinite(meta.exchangeDataDelayedBy) ||
      meta.exchangeDataDelayedBy !== CME_DELAY_MINUTES) {
    throw new Error(`Yahoo 응답 지연시간이 검증된 ${CME_DELAY_MINUTES}분이 아닙니다: ${meta.exchangeDataDelayedBy ?? "없음"}`);
  }
  return { delayMinutes: meta.exchangeDataDelayedBy, delayMetadataVerified: true };
}

function sessionEntryFromQuote(quote, index, timestamp) {
  const bar = {
    at: new Date(timestamp * 1000),
    timestamp,
    bucket: Math.floor(timestamp / BAR_SECONDS) * BAR_SECONDS,
    open: finiteAt(quote.open, index),
    high: finiteAt(quote.high, index),
    low: finiteAt(quote.low, index),
    close: finiteAt(quote.close, index)
  };
  const missingCount = [bar.open, bar.high, bar.low, bar.close]
    .filter(value => value === null).length;
  if (missingCount === 4) return { ...bar, missing: true };
  if (missingCount > 0) {
    throw new Error(`현재 CME 세션의 5분봉 OHLC가 부분 누락되었습니다(index ${index}).`);
  }
  if (!Number.isFinite(bar.at.getTime()) ||
      [bar.open, bar.high, bar.low, bar.close].some(value => value <= 0 || !Number.isFinite(value) || !isTickAligned(value)) ||
      bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.high < bar.low) {
    throw new Error(`유효하지 않은 CME 5분봉입니다(index ${index}).`);
  }
  return { ...bar, missing: false };
}

function validateCurrentSession(timestamps, quote) {
  const latestTimestamp = timestamps.at(-1);
  const session = cmeEquitySessionFor(new Date(latestTimestamp * 1000));
  const startSeconds = session.start.getTime() / 1000;
  const endSeconds = session.end.getTime() / 1000;
  const sessionIndexes = timestamps
    .map((timestamp, index) => ({ timestamp, index }))
    .filter(item => item.timestamp >= startSeconds && item.timestamp < endSeconds);
  if (!sessionIndexes.length) throw new Error("현재 CME 세션에 해당하는 5분봉이 없습니다.");

  const rawEntries = sessionIndexes
    .map(({ timestamp, index }) => sessionEntryFromQuote(quote, index, timestamp));
  if (rawEntries[0].bucket !== startSeconds || rawEntries[0].timestamp !== startSeconds) {
    throw new Error("현재 CME 세션의 첫 5분봉이 없어 자동 계산을 중단합니다.");
  }
  if (rawEntries[0].missing) throw new Error("현재 CME 세션의 첫 5분봉 OHLC가 완전히 누락되었습니다.");
  if (rawEntries.at(-1).missing) throw new Error("현재 CME 세션의 마지막 5분봉 OHLC가 완전히 누락되었습니다.");

  const bucketEntries = [];
  let syntheticSeen = false;
  let missingInteriorBucketCount = 0;
  let missingInteriorBucketAt = null;
  for (let index = 0; index < rawEntries.length; index += 1) {
    const entry = rawEntries[index];
    const isLast = index === rawEntries.length - 1;
    const aligned = entry.timestamp === entry.bucket;
    if (!aligned && (!isLast || syntheticSeen)) {
      throw new Error("마지막 진행봉 이외에 5분 경계에 정렬되지 않은 시각이 있습니다.");
    }
    if (!aligned) syntheticSeen = true;
    if (entry.missing) {
      if (!aligned || index === 0 || isLast) {
        throw new Error("완전 누락 5분봉은 현재 세션의 정렬된 중간 bucket에서만 허용됩니다.");
      }
      missingInteriorBucketCount += 1;
      if (missingInteriorBucketCount > 1) {
        throw new Error("현재 CME 세션의 완전 누락 5분봉이 1개를 초과했습니다.");
      }
      missingInteriorBucketAt = entry.at.toISOString();
    }

    const previous = bucketEntries.at(-1);
    if (!previous) {
      bucketEntries.push(entry);
      continue;
    }
    const difference = entry.bucket - previous.bucket;
    if (difference === BAR_SECONDS) {
      bucketEntries.push(entry);
    } else if (difference === 0 && isLast && !aligned && previous.timestamp === previous.bucket &&
        !previous.missing && !entry.missing) {
      // Yahoo는 같은 5분 bucket의 정렬 봉 뒤에 최신 체결시각 진행봉을 한 번 덧붙인다.
      // 진행봉 범위가 정렬 봉보다 좁아도 이미 관측한 O/H/L을 잃지 않도록 보수적으로 합친다.
      bucketEntries[bucketEntries.length - 1] = {
        ...entry,
        open: previous.open,
        high: Math.max(previous.high, entry.high),
        low: Math.min(previous.low, entry.low),
        close: entry.close
      };
    } else if (difference === 0) {
      throw new Error("현재 CME 세션에 중복된 5분 bucket이 있습니다.");
    } else {
      throw new Error("현재 CME 세션의 5분 bucket이 연속적이지 않습니다.");
    }
  }
  const bucketBars = bucketEntries.filter(entry => !entry.missing);
  return {
    session,
    bucketBars,
    expectedBucketCount: bucketEntries.length,
    syntheticSeen,
    missingInteriorBucketCount,
    missingInteriorBucketAt
  };
}

function requiredRegularMarketPrice(meta, field, label) {
  const value = meta[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || !isTickAligned(value)) {
    throw new Error(`Yahoo meta ${label}가 유효한 MNQ 가격이 아닙니다.`);
  }
  return value;
}

function validateRegularMarketMetadata(meta, bucketBars) {
  const observed = {
    open: bucketBars[0].open,
    high: Math.max(...bucketBars.map(bar => bar.high)),
    low: Math.min(...bucketBars.map(bar => bar.low)),
    current: bucketBars.at(-1).close,
    time: bucketBars.at(-1).timestamp
  };
  const expected = {
    high: requiredRegularMarketPrice(meta, "regularMarketDayHigh", "regularMarketDayHigh"),
    low: requiredRegularMarketPrice(meta, "regularMarketDayLow", "regularMarketDayLow"),
    current: requiredRegularMarketPrice(meta, "regularMarketPrice", "regularMarketPrice")
  };
  if (!Number.isInteger(meta.regularMarketTime) || meta.regularMarketTime <= 0) {
    throw new Error("Yahoo meta regularMarketTime이 유효한 Unix 시각이 아닙니다.");
  }
  expected.time = meta.regularMarketTime;
  if (expected.high !== observed.high || expected.low !== observed.low ||
      expected.current !== observed.current || expected.time !== observed.time) {
    throw new Error("Yahoo meta regularMarket H/L/current/time이 관측 5분봉과 정확히 일치하지 않습니다.");
  }

  const openFields = ["regularMarketOpen", "regularMarketDayOpen"]
    .filter(field => Object.hasOwn(meta, field));
  for (const field of openFields) {
    const expectedOpen = requiredRegularMarketPrice(meta, field, field);
    if (expectedOpen !== observed.open) {
      throw new Error(`Yahoo meta ${field}이 현재 CME 세션 첫 5분봉 시가와 일치하지 않습니다.`);
    }
  }
  return {
    observed,
    openMetadataAvailable: openFields.length > 0,
    fieldsVerified: openFields.length > 0
      ? Object.freeze(["open", "high", "low", "current", "time"])
      : Object.freeze(["high", "low", "current", "time"])
  };
}

export function parseYahooChart(payload, requestedSymbol, fetchedAt = new Date()) {
  const tier = symbolTier(requestedSymbol);
  if (!(fetchedAt instanceof Date) || !Number.isFinite(fetchedAt.getTime())) {
    throw new TypeError("유효한 조회 시각이 필요합니다.");
  }
  if (!payload || typeof payload !== "object" || !payload.chart || typeof payload.chart !== "object") {
    throw new Error("Yahoo chart 응답 스키마가 올바르지 않습니다.");
  }
  if (payload.chart.error) {
    throw providerError("Yahoo chart 공급자 오류가 발생했습니다.");
  }
  if (!Array.isArray(payload.chart.result) || !payload.chart.result.length) {
    throw providerError("시세 응답에 차트 결과가 없습니다.");
  }

  const result = payload.chart.result[0];
  const meta = result?.meta;
  if (!meta || typeof meta !== "object") throw new Error("Yahoo 응답 메타데이터가 없습니다.");
  const returnedSymbol = meta.symbol;
  if (typeof returnedSymbol !== "string" || returnedSymbol.toUpperCase() !== requestedSymbol.toUpperCase()) {
    throw new Error(`반환 종목 불일치: 요청 ${requestedSymbol}, 반환 ${returnedSymbol || "없음"}`);
  }
  const delayMetadata = validateYahooProvenance(meta);

  const quote = result.indicators?.quote?.[0];
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  if (!timestamps.length || !quote || typeof quote !== "object") {
    throw new Error("5분봉 시각 또는 OHLC 배열이 없습니다.");
  }
  for (const field of ["open", "high", "low", "close"]) {
    if (!Array.isArray(quote[field]) || quote[field].length < timestamps.length) {
      throw new Error(`5분봉 ${field} 배열 길이가 시각 배열보다 짧습니다.`);
    }
  }

  let previousTimestamp = null;
  timestamps.forEach(timestamp => {
    if (!Number.isInteger(timestamp) || timestamp <= 0 ||
        (previousTimestamp !== null && timestamp <= previousTimestamp)) {
      throw new Error("5분봉 시각은 유효한 오름차순이어야 합니다.");
    }
    previousTimestamp = timestamp;
  });

  const latestAt = new Date(timestamps.at(-1) * 1000);
  if (latestAt.getTime() > fetchedAt.getTime() + 5 * 60000) {
    throw new Error("시세 원본 시각이 조회 시각보다 비정상적으로 미래입니다.");
  }

  const {
    session,
    bucketBars,
    expectedBucketCount,
    syntheticSeen,
    missingInteriorBucketCount,
    missingInteriorBucketAt
  } = validateCurrentSession(timestamps, quote);
  const currentBar = bucketBars.at(-1);
  const regularMarketVerification = validateRegularMarketMetadata(meta, bucketBars);
  const sessionEndedAtFetch = fetchedAt.getTime() >= session.end.getTime();
  // A wall-clock time after the scheduled close is not enough to call a
  // returned session complete.  The source also has to contain the terminal
  // five-minute bucket (or a synthetic last-trade timestamp inside it).
  const terminalCoverageVerified = currentBar.at.getTime() >=
    session.end.getTime() - BAR_SECONDS * 1000;
  const sessionCompletedAtFetch = sessionEndedAtFetch && terminalCoverageVerified;
  const completedBars = bucketBars.filter((bar, index) => {
    if (syntheticSeen && index === bucketBars.length - 1) return false;
    return (bar.bucket + BAR_SECONDS) * 1000 <= fetchedAt.getTime();
  });
  const trueRanges = missingInteriorBucketCount > 0 ? [] : completedBars.map((bar, index) => {
    const previousClose = completedBars[index - 1]?.close;
    return previousClose === undefined
      ? bar.high - bar.low
      : Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  let atr = null;
  if (trueRanges.length >= 14) {
    atr = trueRanges.slice(0, 14).reduce((sum, value) => sum + value, 0) / 14;
    for (const value of trueRanges.slice(14)) atr = ((atr * 13) + value) / 14;
  }

  return {
    schemaVersion: 1,
    generatedAt: fetchedAt.toISOString(),
    provider: {
      name: "Yahoo Finance chart proxy",
      requestedSymbol,
      returnedSymbol,
      interval: "5m",
      range: "5d-period-window",
      delayed: true,
      delayMinutes: delayMetadata.delayMinutes,
      delayMetadataVerified: delayMetadata.delayMetadataVerified,
      delayLabel: delayMetadata.delayMetadataVerified
        ? `CME 선물 약 ${delayMetadata.delayMinutes}분 지연 참고 시세`
        : "CME 선물 지연 참고 시세 · 원천시각 기준",
      sourceEventAt: currentBar.at.toISOString(),
      sourceTimestampKind: syntheticSeen ? "latest-synthetic-progress-bar" : "latest-returned-bar",
      observedAgeSeconds: Math.max(0, Math.floor((fetchedAt.getTime() - currentBar.at.getTime()) / 1000)),
      requestMode: "user-initiated-single-shot",
      instrumentType: "continuous-futures-proxy",
      tier,
      fallback: false,
      unofficial: true,
      barQuality: missingInteriorBucketCount > 0 ? "one-interior-null-bucket" : "complete",
      missingInteriorBucketCount,
      missingInteriorBucketAt,
      regularMarketMetadataVerified: true,
      regularMarketOpenMetadataAvailable: regularMarketVerification.openMetadataAvailable,
      regularMarketFieldsVerified: regularMarketVerification.fieldsVerified
    },
    session: {
      label: `${session.sessionDate} 17:00 CT ~ 16:00 CT`,
      date: session.sessionDate,
      timeZone: session.timeZone,
      start: session.start.toISOString(),
      end: session.end.toISOString(),
      status: sessionCompletedAtFetch ? "completed" :
        sessionEndedAtFetch ? "ended-incomplete" : "in-progress",
      isCompletedAtFetch: sessionCompletedAtFetch,
      terminalCoverageVerified,
      lastObservedAt: currentBar.at.toISOString(),
      barCount: bucketBars.length,
      expectedBarCount: expectedBucketCount,
      missingInteriorBucketCount
    },
    market: {
      open: regularMarketVerification.observed.open,
      high: regularMarketVerification.observed.high,
      low: regularMarketVerification.observed.low,
      current: regularMarketVerification.observed.current,
      latestBarAt: currentBar.at.toISOString(),
      atr5m14: atr === null ? null : Number(atr.toFixed(6)),
      atrLastCompletedBarAt: missingInteriorBucketCount > 0
        ? null
        : completedBars.at(-1)?.at.toISOString() || null
    },
    limitations: [
      "MNQ=F는 실제 월물이 아닌 연속선물 프록시입니다.",
      `Yahoo의 CME 선물 시세는 약 ${CME_DELAY_MINUTES}분 지연이며 무결점 시세가 아닙니다.`,
      "공급자가 가용성·정확성·연속성을 보장하는 거래용 API가 아닙니다.",
      "CME 세션은 America/Chicago 17:00~익일 16:00을 DST-aware로 재구성했습니다.",
      ...(missingInteriorBucketCount > 0
        ? ["현재 세션 중간 5분봉 1개가 완전히 누락되어 Yahoo regularMarket H/L/current/time을 교차검증했고 5분 ATR은 중지했습니다."]
        : [])
    ]
  };
}

export async function fetchYahooSnapshot(fetchImpl = fetch, fetchedAt = new Date(), options = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch 구현이 필요합니다.");
  if (!(fetchedAt instanceof Date) || !Number.isFinite(fetchedAt.getTime())) {
    throw new TypeError("유효한 조회 시각이 필요합니다.");
  }
  const timeoutMs = normalizeTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const sourceUrl = buildYahooSourceUrl(fetchedAt);
  const readerUrl = `${JINA_READER_ORIGIN}/${sourceUrl.href}`;

  return withRequestTimeout(async signal => {
    const response = await fetchImpl(readerUrl, {
      headers: { "Accept": "application/json" },
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal
    });
    validateJsonResponse(response, fetchedAt);
    const envelope = await readBoundedJson(response);
    const reader = parseReaderEnvelope(envelope, sourceUrl);
    const snapshot = parseYahooChart(reader.payload, PRIMARY_SYMBOL, fetchedAt);
    snapshot.provider.transport = "Jina Reader JSON relay";
    snapshot.provider.relayHost = "r.jina.ai";
    snapshot.provider.sourceHost = YAHOO_HOST;
    snapshot.provider.sourceUrl = reader.sourceUrl;
    return snapshot;
  }, options.signal, timeoutMs);
}
