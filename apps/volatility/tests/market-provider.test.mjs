import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_JSON_RESPONSE_BYTES,
  cmeEquitySessionFor,
  fetchYahooSnapshot,
  parseYahooChart
} from "../js/market-provider.js";

const FETCHED_AT = new Date("2026-08-13T01:00:00Z");

function syncRegularMarketMeta(source, { includeOpen = false } = {}) {
  const result = source.chart.result[0];
  const quote = result.indicators.quote[0];
  const latestTimestamp = result.timestamp.at(-1);
  const session = cmeEquitySessionFor(new Date(latestTimestamp * 1000));
  const startSeconds = session.start.getTime() / 1000;
  const endSeconds = session.end.getTime() / 1000;
  const valid = result.timestamp.map((timestamp, index) => ({
    timestamp,
    open: quote.open[index],
    high: quote.high[index],
    low: quote.low[index],
    close: quote.close[index]
  })).filter(item => item.timestamp >= startSeconds && item.timestamp < endSeconds &&
    [item.open, item.high, item.low, item.close].every(Number.isFinite));
  result.meta.regularMarketDayHigh = Math.max(...valid.map(item => item.high));
  result.meta.regularMarketDayLow = Math.min(...valid.map(item => item.low));
  result.meta.regularMarketPrice = valid.at(-1).close;
  result.meta.regularMarketTime = valid.at(-1).timestamp;
  if (includeOpen) result.meta.regularMarketOpen = valid[0].open;
  else delete result.meta.regularMarketOpen;
  delete result.meta.regularMarketDayOpen;
  return source;
}

function payload(symbol = "MNQ=F") {
  const start = Date.parse("2026-08-12T21:50:00Z") / 1000;
  const timestamp = Array.from({ length: 22 }, (_, index) => start + index * 300);
  const values = timestamp.map((_, index) => 30000 + index);
  const source = {
    chart: {
      error: null,
      result: [{
        meta: {
          symbol,
          dataGranularity: "5m",
          instrumentType: "FUTURE",
          exchangeName: "CME",
          exchangeTimezoneName: "America/New_York",
          currency: "USD",
          exchangeDataDelayedBy: 10
        },
        timestamp,
        indicators: { quote: [{
          open: values,
          high: values.map(value => value + 3),
          low: values.map(value => value - 2),
          close: values.map(value => value + 1)
        }] }
      }]
    }
  };
  return syncRegularMarketMeta(source);
}

function completedSessionPayload(symbol = "MNQ=F") {
  const source = payload(symbol);
  const result = source.chart.result[0];
  const sessionStart = Date.parse("2026-08-13T22:00:00Z") / 1000;
  const barCount = 23 * 12;
  result.timestamp = Array.from({ length: barCount }, (_, index) => sessionStart + index * 300);
  const values = result.timestamp.map((_, index) => 30000 + (index % 16) * 0.25);
  result.indicators.quote[0] = {
    open: values,
    high: values.map(value => value + 1),
    low: values.map(value => value - 0.5),
    close: values.map(value => value + 0.25)
  };
  return syncRegularMarketMeta(source);
}

function yahooSourceUrl(fetchedAt = FETCHED_AT) {
  const period2 = Math.floor(fetchedAt.getTime() / 60000) * 60;
  const url = new URL("https://query2.finance.yahoo.com/v8/finance/chart/MNQ=F");
  url.searchParams.set("interval", "5m");
  url.searchParams.set("period1", String(period2 - 30 * 24 * 60 * 60));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("includePrePost", "true");
  url.searchParams.set("events", "div,splits");
  return url;
}

function readerEnvelope(inner = payload(), fetchedAt = FETCHED_AT, overrides = {}) {
  return {
    code: 200,
    status: 200,
    data: {
      url: yahooSourceUrl(fetchedAt).href,
      content: JSON.stringify(inner),
      httpStatus: 200,
      ...overrides.data
    },
    ...overrides.outer
  };
}

function readerResponse(inner = payload(), fetchedAt = FETCHED_AT, options = {}) {
  return jsonResponse(readerEnvelope(inner, fetchedAt, options));
}

function appendSyntheticBar(source, secondsIntoBucket = 197) {
  const result = source.chart.result[0];
  const quote = result.indicators.quote[0];
  result.timestamp.push(result.timestamp.at(-1) + secondsIntoBucket);
  for (const field of ["open", "high", "low", "close"]) quote[field].push(quote[field].at(-1));
  quote.high[quote.high.length - 1] += 1;
  quote.close[quote.close.length - 1] += 0.25;
}

function removeBar(source, index) {
  const result = source.chart.result[0];
  result.timestamp.splice(index, 1);
  for (const field of ["open", "high", "low", "close"]) {
    result.indicators.quote[0][field].splice(index, 1);
  }
}

function jsonResponse(body, {
  ok = true,
  status = 200,
  contentType = "application/json; charset=utf-8",
  contentLength,
  retryAfter
} = {}) {
  const text = JSON.stringify(body);
  const length = contentLength === undefined ? new TextEncoder().encode(text).byteLength : contentLength;
  return {
    ok,
    status,
    headers: {
      get: name => ({
        "content-type": contentType,
        "content-length": length === null ? null : String(length),
        "retry-after": retryAfter === undefined ? null : String(retryAfter)
      })[name.toLowerCase()] ?? null
    },
    text: async () => text,
    json: async () => body
  };
}

test("Chicago 세션 경계를 서머타임 포함 UTC로 변환한다", () => {
  const summer = cmeEquitySessionFor(new Date("2026-08-13T12:00:00Z"));
  assert.equal(summer.start.toISOString(), "2026-08-12T22:00:00.000Z");
  assert.equal(summer.end.toISOString(), "2026-08-13T21:00:00.000Z");
  const winter = cmeEquitySessionFor(new Date("2026-12-10T12:00:00Z"));
  assert.equal(winter.start.toISOString(), "2026-12-09T23:00:00.000Z");
  assert.equal(winter.end.toISOString(), "2026-12-10T22:00:00.000Z");
});

test("검증된 현재 CME 세션만으로 O/H/L/current와 완료봉 ATR을 만든다", () => {
  const result = parseYahooChart(payload(), "MNQ=F", FETCHED_AT);
  assert.equal(result.provider.range, "30d-period-window");
  assert.equal(result.session.start, "2026-08-12T22:00:00.000Z");
  assert.equal(result.session.barCount, 20);
  assert.equal(result.market.open, 30002);
  assert.equal(result.market.low, 30000);
  assert.equal(result.market.high, 30024);
  assert.equal(result.market.current, 30022);
  assert.ok(result.market.atr5m14 > 0);
  assert.equal(result.market.atrLastCompletedBarAt, result.market.latestBarAt);
  assert.equal(result.provider.delayMinutes, 10);
  assert.equal(result.provider.delayMetadataVerified, true);
  assert.equal(result.provider.delayLabel, "CME 선물 약 10분 지연 참고 시세");
  assert.equal(result.provider.sourceEventAt, result.market.latestBarAt);
  assert.equal(result.provider.requestMode, "user-initiated-single-shot");
  assert.equal(result.provider.tier, "mnq-continuous-proxy");
  assert.equal(result.provider.fallback, false);
  assert.equal(result.provider.barQuality, "complete");
  assert.equal(result.provider.missingInteriorBucketCount, 0);
  assert.equal(result.provider.regularMarketMetadataVerified, true);
  assert.equal(result.provider.regularMarketOpenMetadataAvailable, false);
  assert.deepEqual(result.provider.regularMarketFieldsVerified, ["high", "low", "current", "time"]);
  assert.equal(result.session.expectedBarCount, 20);
  assert.equal(result.session.status, "in-progress");
  assert.equal(result.session.isCompletedAtFetch, false);
  assert.equal(result.session.terminalCoverageVerified, false);
  assert.equal(result.session.lastObservedAt, result.market.latestBarAt);
});

test("토요일 조회는 마지막 관측 세션을 완료 세션으로 명시해 반환한다", () => {
  const saturday = new Date("2026-08-15T03:00:00Z");
  const result = parseYahooChart(completedSessionPayload(), "MNQ=F", saturday);
  assert.equal(result.session.status, "completed");
  assert.equal(result.session.isCompletedAtFetch, true);
  assert.equal(result.session.terminalCoverageVerified, true);
  assert.equal(result.session.end, "2026-08-14T21:00:00.000Z");
  assert.equal(result.session.lastObservedAt, result.market.latestBarAt);
});

test("종료시각이 지났어도 마지막 5분 구간이 없으면 완료로 표시하지 않는다", () => {
  const saturday = new Date("2026-08-15T03:00:00Z");
  const result = parseYahooChart(payload(), "MNQ=F", saturday);
  assert.equal(result.session.status, "ended-incomplete");
  assert.equal(result.session.isCompletedAtFetch, false);
  assert.equal(result.session.terminalCoverageVerified, false);
});

test("마지막 진행봉의 synthetic timestamp는 같은 bucket에 한 번만 허용하고 ATR에서 제외한다", () => {
  const source = payload();
  appendSyntheticBar(source);
  const quote = source.chart.result[0].indicators.quote[0];
  // Synthetic 범위가 직전 정렬봉보다 좁아도 정렬봉의 high/low가 보존되어야 한다.
  quote.open[quote.open.length - 1] = 30022;
  quote.high[quote.high.length - 1] = 30022.5;
  quote.low[quote.low.length - 1] = 30021.75;
  quote.close[quote.close.length - 1] = 30022.25;
  syncRegularMarketMeta(source);
  const result = parseYahooChart(source, "MNQ=F", FETCHED_AT);
  assert.equal(result.session.barCount, 20);
  assert.equal(result.provider.sourceTimestampKind, "latest-synthetic-progress-bar");
  assert.equal(result.market.latestBarAt, "2026-08-12T23:38:17.000Z");
  assert.equal(result.market.high, 30024);
  assert.equal(result.market.current, 30022.25);
  assert.equal(result.market.atrLastCompletedBarAt, "2026-08-12T23:30:00.000Z");
});

test("현재 세션의 완전-null 중간 bucket 하나는 cadence를 보존하고 최신 연속봉 ATR을 다시 계산한다", () => {
  const source = payload();
  const quote = source.chart.result[0].indicators.quote[0];
  for (const field of ["open", "high", "low", "close"]) quote[field][3] = null;
  syncRegularMarketMeta(source);
  const result = parseYahooChart(source, "MNQ=F", FETCHED_AT);
  assert.equal(result.provider.barQuality, "one-interior-null-bucket");
  assert.equal(result.provider.missingInteriorBucketCount, 1);
  assert.equal(result.provider.missingInteriorBucketAt, "2026-08-12T22:05:00.000Z");
  assert.equal(result.session.barCount, 19);
  assert.equal(result.session.expectedBarCount, 20);
  assert.ok(result.provider.atrSourceBarCount >= 14);
  assert.ok(result.market.atr5m14 > 0);
  assert.equal(result.market.atrLastCompletedBarAt, result.market.latestBarAt);
  assert.match(result.limitations.at(-1), /연속 완료봉으로 5분 ATR을 다시 계산/);
});

test("partial-null·마지막·복수 중간 null은 차단하고 시작부 2개까지만 제한 허용한다", async t => {
  await t.test("partial-null", () => {
    const source = payload();
    source.chart.result[0].indicators.quote[0].low[3] = null;
    assert.throws(() => parseYahooChart(source, "MNQ=F", FETCHED_AT), /부분 누락/);
  });
  for (const indexes of [[2], [2, 3]]) {
    const source = payload();
    const quote = source.chart.result[0].indicators.quote[0];
    for (const index of indexes) {
      for (const field of ["open", "high", "low", "close"]) quote[field][index] = null;
    }
    syncRegularMarketMeta(source);
    const parsed = parseYahooChart(source, "MNQ=F", FETCHED_AT);
    assert.equal(parsed.provider.leadingMissingBucketCount, indexes.length);
    assert.equal(parsed.provider.barQuality, "leading-null-buckets");
    assert.equal(parsed.provider.firstObservedBarAt,
      new Date(source.chart.result[0].timestamp[2 + indexes.length] * 1000).toISOString());
  }
  for (const [name, indexes, expected] of [
    ["three leading", [2, 3, 4], /시작부의 유효한 5분봉/],
    ["last", [21], /마지막 5분봉 OHLC가 완전히 누락/],
    ["two", [3, 4], /1개를 초과/]
  ]) {
    await t.test(name, () => {
      const source = payload();
      const quote = source.chart.result[0].indicators.quote[0];
      for (const index of indexes) {
        for (const field of ["open", "high", "low", "close"]) quote[field][index] = null;
      }
      syncRegularMarketMeta(source);
      assert.throws(() => parseYahooChart(source, "MNQ=F", FETCHED_AT), expected);
    });
  }
});

test("현재 세션의 누락된 5분 bucket은 차단한다", () => {
  const source = payload();
  removeBar(source, 5);
  assert.throws(
    () => parseYahooChart(source, "MNQ=F", FETCHED_AT),
    /연속적이지 않습니다/
  );
});

test("중간 비정렬 timestamp와 중복 bucket은 차단한다", () => {
  const unaligned = payload();
  unaligned.chart.result[0].timestamp[5] += 30;
  assert.throws(
    () => parseYahooChart(unaligned, "MNQ=F", new Date("2026-08-13T01:00:00Z")),
    /마지막 진행봉 이외/
  );

  const duplicate = payload();
  duplicate.chart.result[0].timestamp[5] = duplicate.chart.result[0].timestamp[4] + 30;
  assert.throws(
    () => parseYahooChart(duplicate, "MNQ=F", new Date("2026-08-13T01:00:00Z")),
    /마지막 진행봉 이외|중복된/
  );
});

test("dataGranularity 누락 또는 5m 이외 응답은 차단한다", () => {
  const missing = payload();
  delete missing.chart.result[0].meta.dataGranularity;
  assert.throws(
    () => parseYahooChart(missing, "MNQ=F", new Date("2026-08-13T01:00:00Z")),
    /정확한 5m가 아닙니다/
  );
  const wrong = payload();
  wrong.chart.result[0].meta.dataGranularity = "1m";
  assert.throws(
    () => parseYahooChart(wrong, "MNQ=F", new Date("2026-08-13T01:00:00Z")),
    /정확한 5m가 아닙니다/
  );
});

test("Yahoo provenance가 FUTURE/CME/허용 시간대/USD와 다르면 차단한다", async t => {
  for (const [field, value, expected] of [
    ["instrumentType", "EQUITY", /FUTURE가 아닙니다/],
    ["exchangeName", "NASDAQ", /CME 계열이 아닙니다/],
    ["exchangeTimezoneName", "Europe/London", /시간대가 허용값이 아닙니다/],
    ["currency", "KRW", /USD가 아닙니다/]
  ]) {
    await t.test(field, () => {
      const source = payload();
      source.chart.result[0].meta[field] = value;
      assert.throws(
        () => parseYahooChart(source, "MNQ=F", new Date("2026-08-13T01:00:00Z")),
        expected
      );
    });
  }
  const chicago = payload();
  chicago.chart.result[0].meta.exchangeTimezoneName = "America/Chicago";
  assert.doesNotThrow(() => parseYahooChart(chicago, "MNQ=F", new Date("2026-08-13T01:00:00Z")));
});

test("Yahoo exchangeDataDelayedBy가 없으면 원천시각 정책에 맡기고, 있으면 숫자 10만 허용한다", () => {
  const valid = parseYahooChart(payload(), "MNQ=F", FETCHED_AT);
  assert.equal(valid.provider.delayMinutes, 10);
  assert.equal(valid.provider.delayMetadataVerified, true);

  const missing = payload();
  delete missing.chart.result[0].meta.exchangeDataDelayedBy;
  const unverified = parseYahooChart(missing, "MNQ=F", FETCHED_AT);
  assert.equal(unverified.provider.delayMinutes, null);
  assert.equal(unverified.provider.delayMetadataVerified, false);
  assert.match(unverified.provider.delayLabel, /원천시각 기준/);

  for (const value of [undefined, null, 0, 60]) {
    const source = payload();
    source.chart.result[0].meta.exchangeDataDelayedBy = value;
    assert.throws(
      () => parseYahooChart(source, "MNQ=F", FETCHED_AT),
      /지연시간이 검증된 10분이 아닙니다/
    );
  }
});

test("Yahoo regularMarket H/L/current/time과 제공된 open은 관측 세션과 정확히 일치해야 한다", async t => {
  const withOpen = syncRegularMarketMeta(payload(), { includeOpen: true });
  const verified = parseYahooChart(withOpen, "MNQ=F", FETCHED_AT);
  assert.equal(verified.provider.regularMarketOpenMetadataAvailable, true);
  assert.deepEqual(verified.provider.regularMarketFieldsVerified, ["open", "high", "low", "current", "time"]);

  for (const [field, mutate, expected] of [
    ["regularMarketDayHigh", value => value + 0.25, /H\/L\/current\/time/],
    ["regularMarketDayLow", value => value - 0.25, /H\/L\/current\/time/],
    ["regularMarketPrice", value => value - 0.25, /H\/L\/current\/time/],
    ["regularMarketTime", value => value - 1, /H\/L\/current\/time/],
    ["regularMarketOpen", value => value + 0.25, /첫 5분봉 시가/]
  ]) {
    await t.test(field, () => {
      const source = syncRegularMarketMeta(payload(), { includeOpen: field === "regularMarketOpen" });
      source.chart.result[0].meta[field] = mutate(source.chart.result[0].meta[field]);
      assert.throws(() => parseYahooChart(source, "MNQ=F", FETCHED_AT), expected);
    });
  }
});

test("MNQ 성공 시 한 번만 조회하고 인증정보·캐시 없이 요청한다", async () => {
  const calls = [];
  const snapshot = await fetchYahooSnapshot(async (url, options) => {
    calls.push({ url, options });
    return readerResponse(payload(), FETCHED_AT);
  }, FETCHED_AT);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/r\.jina\.ai\/https:\/\/query2\.finance\.yahoo\.com\/v8\/finance\/chart\/MNQ=F\?/);
  const requested = new URL(calls[0].url.replace("https://r.jina.ai/", ""));
  assert.equal(requested.searchParams.get("period2"), String(FETCHED_AT.getTime() / 1000));
  assert.equal(Number(requested.searchParams.get("period2")) - Number(requested.searchParams.get("period1")), 2592000);
  assert.deepEqual(calls[0].options.headers, { Accept: "application/json" });
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(snapshot.provider.tier, "mnq-continuous-proxy");
  assert.equal(snapshot.provider.transport, "Jina Reader JSON relay");
  assert.equal(snapshot.provider.relayHost, "r.jina.ai");
  assert.equal(snapshot.provider.sourceHost, "query2.finance.yahoo.com");
  assert.match(snapshot.provider.sourceUrl, /^https:\/\/query2\.finance\.yahoo\.com\/v8\/finance\/chart\/MNQ=F\?/);
});

test("현재 Jina 성공 envelope의 status 20000도 code 200과 함께 허용한다", async () => {
  const response = readerEnvelope(payload(), FETCHED_AT);
  response.status = 20000;
  const snapshot = await fetchYahooSnapshot(async () => jsonResponse(response), FETCHED_AT);
  assert.equal(snapshot.provider.returnedSymbol, "MNQ=F");
});

test("Jina Reader JSON envelope와 canonical 고정 원본 URL만 허용한다", async t => {
  for (const [name, mutate, expected] of [
    ["code", envelope => { envelope.code = 201; }, /envelope 검증/],
    ["status", envelope => { envelope.status = "200"; }, /envelope 검증/],
    ["data", envelope => { envelope.data = []; }, /envelope 검증/],
    ["source status", envelope => { envelope.data.httpStatus = 404; }, /원본 시세 응답 상태/],
    ["content type", envelope => { envelope.data.content = {}; }, /content가 올바르지/],
    ["inner JSON", envelope => { envelope.data.content = "not-json"; }, /Yahoo JSON 형식/],
    ["host", envelope => { envelope.data.url = envelope.data.url.replace("query2.finance.yahoo.com", "evil.example"); }, /고정 MNQ 요청과 일치/],
    ["encoded slash path", envelope => { envelope.data.url = envelope.data.url.replace("/v8/finance/chart/", "/v8/finance%2Fchart/"); }, /고정 MNQ 요청과 일치/],
    ["symbol", envelope => { envelope.data.url = envelope.data.url.replace("MNQ=F", "NQ=F"); }, /고정 MNQ 요청과 일치/],
    ["period", envelope => { const url = new URL(envelope.data.url); url.searchParams.set("period2", String(Number(url.searchParams.get("period2")) - 60)); envelope.data.url = url.href; }, /고정 MNQ 요청과 일치/],
    ["extra", envelope => { envelope.data.url += "&crumb=secret"; }, /고정 MNQ 요청과 일치/],
    ["duplicate", envelope => { envelope.data.url += "&interval=5m"; }, /고정 MNQ 요청과 일치/]
  ]) {
    await t.test(name, async () => {
      const envelope = readerEnvelope(payload(), FETCHED_AT);
      mutate(envelope);
      await assert.rejects(
        fetchYahooSnapshot(async () => jsonResponse(envelope), FETCHED_AT),
        expected
      );
    });
  }
});

test("Reader content를 포함한 envelope 전체에 512KiB 상한을 적용한다", async () => {
  const envelope = readerEnvelope(payload(), FETCHED_AT);
  envelope.data.content = "x".repeat(MAX_JSON_RESPONSE_BYTES + 1);
  await assert.rejects(
    fetchYahooSnapshot(async () => jsonResponse(envelope, { contentLength: null }), FETCHED_AT),
    error => error.metadata?.code === "response-too-large" &&
      error.metadata.observedBytes > MAX_JSON_RESPONSE_BYTES
  );
});

test("MNQ no-data는 NQ로 대체하지 않고 한 번의 요청으로 종료한다", async () => {
  const urls = [];
  await assert.rejects(fetchYahooSnapshot(async (url) => {
    urls.push(url);
    return readerResponse({ chart: { error: null, result: [] } }, FETCHED_AT);
  }, FETCHED_AT), /차트 결과가 없습니다/);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/MNQ=F\?/);
});

test("MNQ HTTP 오류도 다른 종목 재시도 없이 metadata를 보존한다", async () => {
  let calls = 0;
  await assert.rejects(
    fetchYahooSnapshot(async () => {
      calls += 1;
      return jsonResponse({}, { ok: false, status: 404 });
    }, FETCHED_AT),
    error => error.message === "HTTP 404" && error.metadata?.code === "http-error"
  );
  assert.equal(calls, 1);
});

test("Yahoo chart.error description은 외부 오류 메시지에 노출하지 않는다", async () => {
  const secret = "upstream internal query shard user-token=very-secret";
  await assert.rejects(
    fetchYahooSnapshot(async () => readerResponse({
      chart: { error: { code: "Bad Request", description: secret }, result: null }
    }, FETCHED_AT), FETCHED_AT),
    error => /공급자 오류/.test(error.message) && !error.message.includes(secret)
  );
});

test("HTML 차단 응답은 JSON으로 읽지 않는다", async () => {
  let jsonReads = 0;
  let calls = 0;
  await assert.rejects(
    fetchYahooSnapshot(async () => {
      calls += 1;
      return {
        ...jsonResponse({}, { contentType: "text/html" }),
        json: async () => {
          jsonReads += 1;
          throw new Error("민감할 수 있는 HTML 본문");
        }
      };
    }, FETCHED_AT),
    /JSON이 아닌 응답/
  );
  assert.equal(jsonReads, 0);
  assert.equal(calls, 1);
});

test("HTTP 429 Retry-After를 안전한 metadata로 전달하고 본문·자동 재시도를 차단한다", async () => {
  let jsonReads = 0;
  let textReads = 0;
  let calls = 0;
  const response = {
    ...jsonResponse({}, { ok: false, status: 429, retryAfter: 120 }),
    text: async () => {
      textReads += 1;
      throw new Error("응답 본문 비밀값");
    },
    json: async () => {
      jsonReads += 1;
      throw new Error("응답 본문 비밀값");
    }
  };
  await assert.rejects(
    fetchYahooSnapshot(async () => {
      calls += 1;
      return response;
    }, FETCHED_AT),
    error => {
      assert.match(error.message, /HTTP 429/);
      assert.match(error.message, /120초 후/);
      assert.match(error.message, /자동 재시도하지 않습니다/);
      assert.doesNotMatch(error.message, /비밀값/);
      assert.deepEqual(error.metadata, {
        code: "rate-limited",
        status: 429,
        retryAfterSeconds: 120,
        retryAt: "2026-08-13T01:02:00.000Z",
        automaticRetry: false
      });
      return true;
    }
  );
  assert.equal(jsonReads, 0);
  assert.equal(textReads, 0);
  assert.equal(calls, 1);
});

test("HTTP-date Retry-After도 기준시각 대비 초와 절대시각으로 정규화한다", async () => {
  let calls = 0;
  await assert.rejects(
    fetchYahooSnapshot(async () => {
      calls += 1;
      return jsonResponse({}, {
        ok: false,
        status: 429,
        retryAfter: "Thu, 13 Aug 2026 01:02:30 GMT"
      });
    }, FETCHED_AT),
    error => {
      assert.equal(error.metadata.retryAfterSeconds, 150);
      assert.equal(error.metadata.retryAt, "2026-08-13T01:02:30.000Z");
      assert.equal(error.metadata.automaticRetry, false);
      return true;
    }
  );
  assert.equal(calls, 1);
});

test("Content-Length가 안전 상한을 넘으면 본문을 읽기 전에 차단한다", async () => {
  let textReads = 0;
  const response = {
    ...jsonResponse({}, { contentLength: MAX_JSON_RESPONSE_BYTES + 1 }),
    text: async () => {
      textReads += 1;
      throw new Error("과대 본문 비밀값");
    }
  };
  await assert.rejects(
    fetchYahooSnapshot(async () => response, FETCHED_AT),
    error => {
      assert.match(error.message, /안전 상한을 초과/);
      assert.doesNotMatch(error.message, /비밀값/);
      assert.deepEqual(error.metadata, {
        code: "response-too-large",
        maxResponseBytes: MAX_JSON_RESPONSE_BYTES,
        declaredBytes: MAX_JSON_RESPONSE_BYTES + 1,
        observedBytes: null
      });
      return true;
    }
  );
  assert.equal(textReads, 0);
});

test("Content-Length가 축소돼도 실제 stream 읽기 크기가 상한을 넘으면 즉시 취소한다", async () => {
  const chunks = [new Uint8Array(MAX_JSON_RESPONSE_BYTES), new Uint8Array([123])];
  let reads = 0;
  let cancels = 0;
  let releases = 0;
  const response = {
    ...jsonResponse({}, { contentLength: 1 }),
    body: {
      getReader() {
        return {
          async read() {
            const value = chunks[reads];
            reads += 1;
            return value ? { done: false, value } : { done: true, value: undefined };
          },
          async cancel() { cancels += 1; },
          releaseLock() { releases += 1; }
        };
      }
    }
  };
  await assert.rejects(
    fetchYahooSnapshot(async () => response, FETCHED_AT),
    error => {
      assert.equal(error.metadata.code, "response-too-large");
      assert.equal(error.metadata.declaredBytes, null);
      assert.equal(error.metadata.observedBytes, MAX_JSON_RESPONSE_BYTES + 1);
      return true;
    }
  );
  assert.equal(reads, 2);
  assert.equal(cancels, 1);
  assert.equal(releases, 1);
});

test("본문 stream 읽기 실패의 내부 상세를 사용자 오류에 노출하지 않는다", async () => {
  const secret = "upstream body reader token=very-secret";
  const response = {
    ...jsonResponse({}, { contentLength: null }),
    body: {
      getReader() {
        return {
          async read() { throw new Error(secret); },
          releaseLock() {}
        };
      }
    }
  };
  await assert.rejects(
    fetchYahooSnapshot(async () => response, FETCHED_AT),
    error => {
      assert.match(error.message, /본문을 안전하게 읽지 못했습니다/);
      assert.doesNotMatch(error.message, /very-secret/);
      assert.equal(error.metadata.code, "body-read-failed");
      return true;
    }
  );
});

test("반환 종목이 요청 종목과 다르면 거부한다", () => {
  assert.throws(
    () => parseYahooChart(payload("NQ=F"), "MNQ=F", FETCHED_AT),
    /반환 종목 불일치/
  );
});

test("CME 0.25 tick에 맞지 않는 가격은 거부한다", () => {
  const source = payload();
  source.chart.result[0].indicators.quote[0].close[4] = 30004.1;
  assert.throws(
    () => parseYahooChart(source, "MNQ=F", FETCHED_AT),
    /유효하지 않은 CME 5분봉/
  );
});

test("주입한 제한시간이 지나면 fetch 구현이 signal을 무시해도 종료한다", async () => {
  await assert.rejects(
    fetchYahooSnapshot(() => new Promise(() => {}), FETCHED_AT, {
      timeoutMs: 10
    }),
    /총 10ms 제한시간/
  );
});

test("응답 본문 JSON 읽기까지 동일한 제한시간 안에 끝나야 한다", async () => {
  await assert.rejects(
    fetchYahooSnapshot(async () => ({
      ...jsonResponse(readerEnvelope(payload(), FETCHED_AT)),
      text: () => new Promise(() => {})
    }), FETCHED_AT, { timeoutMs: 10 }),
    /총 10ms 제한시간/
  );
});

test("외부 AbortSignal 취소 뒤 추가 요청을 시작하지 않는다", async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = fetchYahooSnapshot((url, options) => {
    calls += 1;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    });
  }, FETCHED_AT, { signal: controller.signal, timeoutMs: 1000 });
  controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
  assert.equal(calls, 1);
});
