const CHICAGO_TIME_ZONE = "America/Chicago";

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
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function parseYahooChart(payload, requestedSymbol, fetchedAt = new Date()) {
  const result = payload?.chart?.result?.[0];
  if (!result || payload?.chart?.error) {
    throw new Error(payload?.chart?.error?.description || "시세 응답에 차트 결과가 없습니다.");
  }
  const quote = result.indicators?.quote?.[0];
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const bars = timestamps.map((timestamp, index) => ({
    at: new Date(timestamp * 1000),
    open: finiteAt(quote?.open, index),
    high: finiteAt(quote?.high, index),
    low: finiteAt(quote?.low, index),
    close: finiteAt(quote?.close, index)
  })).filter(bar => Number.isFinite(bar.at.getTime()) &&
    [bar.open, bar.high, bar.low, bar.close].every(value => Number.isFinite(value) && value > 0) &&
    bar.high >= Math.max(bar.open, bar.close) && bar.low <= Math.min(bar.open, bar.close));
  if (!bars.length) throw new Error("유효한 5분봉이 없습니다.");

  const latest = bars.at(-1);
  const session = cmeEquitySessionFor(latest.at);
  const sessionBars = bars.filter(bar => bar.at >= session.start && bar.at <= session.end);
  if (!sessionBars.length) throw new Error("현재 CME 세션에 해당하는 5분봉이 없습니다.");

  const currentBar = sessionBars.at(-1);
  // Yahoo can append a synthetic, non-aligned last timestamp for the in-progress quote.
  // Excluding the final returned bar keeps future/current partial information out of ATR.
  const completedBars = bars.slice(0, -1)
    .filter(bar => bar.at.getTime() + 5 * 60000 <= fetchedAt.getTime());
  const trueRanges = completedBars.map((bar, index) => {
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
      returnedSymbol: result.meta?.symbol || requestedSymbol,
      interval: result.meta?.dataGranularity || "5m",
      range: "2d",
      delayed: true,
      unofficial: true
    },
    session: {
      label: `${session.sessionDate} 17:00 CT ~ 16:00 CT`,
      date: session.sessionDate,
      timeZone: session.timeZone,
      start: session.start.toISOString(),
      end: session.end.toISOString(),
      barCount: sessionBars.length
    },
    market: {
      open: sessionBars[0].open,
      high: Math.max(...sessionBars.map(bar => bar.high)),
      low: Math.min(...sessionBars.map(bar => bar.low)),
      current: currentBar.close,
      latestBarAt: currentBar.at.toISOString(),
      atr5m14: atr === null ? null : Number(atr.toFixed(6)),
      atrLastCompletedBarAt: completedBars.at(-1)?.at.toISOString() || null
    },
    limitations: [
      "MNQ=F/NQ=F는 실제 월물이 아닌 연속선물 프록시입니다.",
      "제공자가 공식 거래소 피드나 무지연 시세를 보장하지 않습니다.",
      "CME 세션은 America/Chicago 17:00~익일 16:00을 DST-aware로 재구성했습니다."
    ]
  };
}

export async function fetchYahooSnapshot(fetchImpl = fetch, fetchedAt = new Date()) {
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  const symbols = ["MNQ=F", "NQ=F"];
  const failures = [];
  for (const symbol of symbols) {
    for (const host of hosts) {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
        "?interval=5m&range=2d&includePrePost=true&events=div%2Csplits";
      try {
        const response = await fetchImpl(url, {
          headers: { "Accept": "application/json" },
          cache: "no-store"
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseYahooChart(await response.json(), symbol, fetchedAt);
      } catch (error) {
        failures.push(`${host}/${symbol}: ${error.message}`);
      }
    }
  }
  throw new Error(failures.join(" | "));
}
