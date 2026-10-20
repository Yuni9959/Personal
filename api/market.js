import { parseYahooChart, SESSION_RANGE_COLUMNS } from "../apps/volatility/js/market-provider.js";

export const MARKET_API_VERSION = "2026-10-20.4";
const ORIGINS = new Set(["https://yuni9959.github.io", "http://localhost:8080", "http://127.0.0.1:8080"]);

// This endpoint accepts no destination or symbol supplied by the caller.
// Every request fetches a fresh chart; no quote is stored in a CDN or database.
export async function loadMarket(fetchImpl = fetch, now = new Date()) {
  const failures = [];
  const deadline = AbortSignal.timeout(8500);
  let rangeEvidence;
  async function fetchRangeEvidence() {
    if (rangeEvidence) return rangeEvidence;
    const response = await fetchImpl("https://scanner.tradingview.com/futures/scan", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 PersonalTap/1.0", "Cache-Control": "no-cache" },
      body: JSON.stringify({ symbols: { tickers: ["CME_MINI:MNQ1!"] }, columns: SESSION_RANGE_COLUMNS }),
      signal: AbortSignal.any([deadline, AbortSignal.timeout(2500)])
    });
    if (!response.ok) throw new Error(`independent range HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 16384) throw new Error("independent range response too large");
    rangeEvidence = { provider: "tradingview-scanner", fetchedAt: now.toISOString(),
      payload: JSON.parse(new TextDecoder().decode(bytes)) };
    return rangeEvidence;
  }
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = new URL(`https://${host}/v8/finance/chart/MNQ%3DF`);
      const end = Math.floor(now.getTime() / 60000) * 60;
      for (const [key, value] of Object.entries({ interval: "5m", period1: end - 30 * 86400, period2: end, includePrePost: "true" })) url.searchParams.set(key, value);
      const response = await fetchImpl(url, {
        headers: { "User-Agent": "Mozilla/5.0 PersonalTap/1.0", Accept: "application/json", "Cache-Control": "no-cache" },
        cache: "no-store", signal: AbortSignal.any([deadline, AbortSignal.timeout(4000)])
      });
      if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 1024 * 1024) throw new Error("upstream response too large");
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      let verified;
      try {
        try { verified = parseYahooChart(payload, "MNQ=F", now, { sessionBarsAuthoritative: true }); }
        catch (error) {
          // A null bar plus Yahoo's inconsistent daily summary cannot verify
          // session extremes alone. Obtain independent session evidence;
          // never fill a missing bar or turn a request time into a quote time.
          if (error.code !== "session-range-unverified") throw error;
          payload.rangeEvidence = await fetchRangeEvidence();
          verified = parseYahooChart(payload, "MNQ=F", now, { sessionBarsAuthoritative: true });
        }
      }
      catch (error) {
        const x = payload.chart?.result?.[0];
        const q = x?.indicators?.quote?.[0];
        console.error("market-validation", JSON.stringify({ host, now: now.toISOString(), metaTime: x?.meta?.regularMarketTime, metaCurrent: x?.meta?.regularMarketPrice, metaHigh: x?.meta?.regularMarketDayHigh, metaLow: x?.meta?.regularMarketDayLow, tail: x?.timestamp?.slice(-3), tailClose: q?.close?.slice(-3) }));
        throw error;
      }
      // Return only chart fields needed for independent browser validation.
      const chart = payload.chart.result[0];
      const { tradingPeriods, validRanges, ...meta } = chart.meta;
      return {
        ...(payload.rangeEvidence ? { rangeEvidence: payload.rangeEvidence } : {}),
        chart: { error: null, result: [{ meta, timestamp: chart.timestamp, indicators: { quote: [Object.fromEntries(
          ["open", "high", "low", "close"].map(key => [key, chart.indicators.quote[0][key]])
        )] } }] },
        service: { version: MARKET_API_VERSION, sourceHost: host, fetchedAt: now.toISOString(), sourceEventAt: verified.market.latestBarAt }
      };
    } catch (error) { failures.push(`${host}: ${error.message}`); }
  }
  throw new Error(failures.join("; "));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const origin = req.headers?.origin;
  if (origin && !ORIGINS.has(origin)) return res.status(403).json({ error: "origin-not-allowed" });
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method-not-allowed" });
  try { return res.status(200).json(await loadMarket()); }
  catch (error) {
    console.error("market-upstream-failed", error.message);
    res.setHeader("Retry-After", "30");
    return res.status(503).json({ error: "시세 원천 조회에 실패했습니다. 잠시 후 다시 확인하세요.", version: MARKET_API_VERSION });
  }
}
