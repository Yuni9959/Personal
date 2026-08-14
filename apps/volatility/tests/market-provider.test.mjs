import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_JSON_RESPONSE_BYTES,
  cmeEquitySessionFor,
  fetchYahooSnapshot,
  parseYahooChart
} from "../js/market-provider.js";

function payload(symbol = "MNQ=F") {
  const start = Date.parse("2026-08-12T21:50:00Z") / 1000;
  const timestamp = Array.from({ length: 22 }, (_, index) => start + index * 300);
  const values = timestamp.map((_, index) => 30000 + index);
  return {
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
  const result = parseYahooChart(payload(), "MNQ=F", new Date("2026-08-13T01:00:00Z"));
  assert.equal(result.provider.range, "2d");
  assert.equal(result.session.start, "2026-08-12T22:00:00.000Z");
  assert.equal(result.session.barCount, 20);
  assert.equal(result.market.open, 30002);
  assert.equal(result.market.low, 30000);
  assert.equal(result.market.high, 30024);
  assert.equal(result.market.current, 30022);
  assert.ok(result.market.atr5m14 > 0);
  assert.equal(result.market.atrLastCompletedBarAt, result.market.latestBarAt);
  assert.equal(result.provider.delayMinutes, 10);
  assert.equal(result.provider.delayLabel, "CME 선물 약 10분 지연 참고 시세");
  assert.equal(result.provider.sourceEventAt, result.market.latestBarAt);
  assert.equal(result.provider.requestMode, "user-initiated-single-shot");
  assert.equal(result.provider.tier, "mnq-continuous-proxy");
  assert.equal(result.provider.fallback, false);
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
  const result = parseYahooChart(source, "MNQ=F", new Date("2026-08-13T01:00:00Z"));
  assert.equal(result.session.barCount, 20);
  assert.equal(result.provider.sourceTimestampKind, "latest-synthetic-progress-bar");
  assert.equal(result.market.latestBarAt, "2026-08-12T23:38:17.000Z");
  assert.equal(result.market.high, 30024);
  assert.equal(result.market.current, 30022.25);
  assert.equal(result.market.atrLastCompletedBarAt, "2026-08-12T23:30:00.000Z");
});

test("현재 세션의 null OHLC는 조용히 건너뛰지 않고 차단한다", () => {
  const source = payload();
  source.chart.result[0].indicators.quote[0].low[3] = null;
  assert.throws(
    () => parseYahooChart(source, "MNQ=F", new Date("2026-08-13T01:00:00Z")),
    /OHLC가 누락/
  );
});

test("현재 세션의 누락된 5분 bucket은 차단한다", () => {
  const source = payload();
  removeBar(source, 5);
  assert.throws(
    () => parseYahooChart(source, "MNQ=F", new Date("2026-08-13T01:00:00Z")),
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

test("Yahoo exchangeDataDelayedBy는 숫자 10만 허용하고 검증값을 스냅샷에 기록한다", () => {
  const valid = parseYahooChart(payload(), "MNQ=F", new Date("2026-08-13T01:00:00Z"));
  assert.equal(valid.provider.delayMinutes, 10);

  for (const value of [undefined, 0, 60]) {
    const source = payload();
    if (value === undefined) delete source.chart.result[0].meta.exchangeDataDelayedBy;
    else source.chart.result[0].meta.exchangeDataDelayedBy = value;
    assert.throws(
      () => parseYahooChart(source, "MNQ=F", new Date("2026-08-13T01:00:00Z")),
      /지연시간이 검증된 10분이 아닙니다/
    );
  }
});

test("MNQ 성공 시 한 번만 조회하고 인증정보·캐시 없이 요청한다", async () => {
  const calls = [];
  const snapshot = await fetchYahooSnapshot(async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(payload());
  }, new Date("2026-08-13T01:00:00Z"));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /MNQ%3DF/);
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  assert.equal(calls[0].options.headers.Accept, "application/json");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(snapshot.provider.tier, "mnq-continuous-proxy");
});

test("MNQ no-data일 때만 NQ를 최대 한 번 조회하며 하나의 timeout signal을 공유한다", async () => {
  const urls = [];
  const signals = [];
  const snapshot = await fetchYahooSnapshot(async (url, options) => {
    urls.push(url);
    signals.push(options.signal);
    if (url.includes("MNQ%3DF")) return jsonResponse({ chart: { error: null, result: [] } });
    return jsonResponse(payload("NQ=F"));
  }, new Date("2026-08-13T01:00:00Z"));
  assert.equal(snapshot.provider.requestedSymbol, "NQ=F");
  assert.equal(snapshot.provider.tier, "nq-continuous-fallback-proxy");
  assert.equal(snapshot.provider.fallback, true);
  assert.equal(snapshot.provider.fallbackFrom, "MNQ=F");
  assert.match(snapshot.provider.fallbackReason, /차트 결과가 없습니다/);
  assert.match(snapshot.limitations[0], /NQ 연속선물 대체/);
  assert.equal(urls.length, 2);
  assert.strictEqual(signals[0], signals[1]);
  assert.ok(urls.every(url => url.includes("range=2d")));
});

test("MNQ와 조건부 NQ fallback 전체가 하나의 총 timeout budget을 사용한다", async () => {
  let calls = 0;
  const startedAt = Date.now();
  await assert.rejects(
    fetchYahooSnapshot(async (url, options) => {
      calls += 1;
      if (url.includes("MNQ%3DF")) {
        await new Promise(resolve => setTimeout(resolve, 15));
        return jsonResponse({ chart: { error: null, result: [] } });
      }
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    }, new Date("2026-08-13T01:00:00Z"), { timeoutMs: 30 }),
    /총 30ms 제한시간/
  );
  assert.equal(calls, 2);
  assert.ok(Date.now() - startedAt < 80);
});

test("Yahoo chart.error description은 외부 오류 메시지에 노출하지 않는다", async () => {
  const secret = "upstream internal query shard user-token=very-secret";
  await assert.rejects(
    fetchYahooSnapshot(async () => jsonResponse({
      chart: { error: { code: "Bad Request", description: secret }, result: null }
    }), new Date("2026-08-13T01:00:00Z")),
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
    }, new Date("2026-08-13T01:00:00Z")),
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
    }, new Date("2026-08-13T01:00:00Z")),
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
    }, new Date("2026-08-13T01:00:00Z")),
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
    fetchYahooSnapshot(async () => response, new Date("2026-08-13T01:00:00Z")),
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
    fetchYahooSnapshot(async () => response, new Date("2026-08-13T01:00:00Z")),
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
    fetchYahooSnapshot(async () => response, new Date("2026-08-13T01:00:00Z")),
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
    () => parseYahooChart(payload("NQ=F"), "MNQ=F", new Date("2026-08-13T01:00:00Z")),
    /반환 종목 불일치/
  );
});

test("CME 0.25 tick에 맞지 않는 가격은 거부한다", () => {
  const source = payload();
  source.chart.result[0].indicators.quote[0].close[4] = 30004.1;
  assert.throws(
    () => parseYahooChart(source, "MNQ=F", new Date("2026-08-13T01:00:00Z")),
    /유효하지 않은 CME 5분봉/
  );
});

test("주입한 제한시간이 지나면 fetch 구현이 signal을 무시해도 종료한다", async () => {
  await assert.rejects(
    fetchYahooSnapshot(() => new Promise(() => {}), new Date("2026-08-13T01:00:00Z"), {
      timeoutMs: 10,
      allowNqFallback: false
    }),
    /총 10ms 제한시간/
  );
});

test("응답 본문 JSON 읽기까지 동일한 제한시간 안에 끝나야 한다", async () => {
  await assert.rejects(
    fetchYahooSnapshot(async () => ({
      ...jsonResponse(payload()),
      text: () => new Promise(() => {})
    }), new Date("2026-08-13T01:00:00Z"), { timeoutMs: 10, allowNqFallback: false }),
    /총 10ms 제한시간/
  );
});

test("외부 AbortSignal 취소 뒤 NQ fallback을 시작하지 않는다", async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = fetchYahooSnapshot((url, options) => {
    calls += 1;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    });
  }, new Date("2026-08-13T01:00:00Z"), { signal: controller.signal, timeoutMs: 1000 });
  controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
  assert.equal(calls, 1);
});
