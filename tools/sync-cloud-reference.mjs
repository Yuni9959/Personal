import fs from "node:fs/promises";
import { buildWeeklyReference, currentKstWeek, renderReferenceModule } from "../apps/volatility/tools/build-weekly-reference.mjs";

const output = new URL("../apps/volatility/js/weekly-reference.generated.js", import.meta.url);
const week = currentKstWeek();
const current = await fs.readFile(output, "utf8");
if (current.includes(`"effectiveFrom": "${week.effectiveFrom}"`) && !process.argv.includes("--force")) {
  console.log(`Weekly reference already current: ${week.effectiveFrom}`);
} else {
  let payload;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const end = Math.floor(Date.now() / 1000);
      const response = await fetch(`https://${host}/v8/finance/chart/NQ%3DF?interval=1d&period1=${end - 6 * 366 * 86400}&period2=${end}`, {
        headers: { "User-Agent": "Mozilla/5.0 PersonalTap/1.0" }, signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const chart = (await response.json()).chart?.result?.[0];
      if (chart?.meta?.symbol !== "NQ=F" || chart.meta.instrumentType !== "FUTURE" || chart.meta.currency !== "USD" || chart.meta.exchangeName !== "CME" || chart.meta.dataGranularity !== "1d") throw new Error("NQ daily provenance mismatch");
      const q = chart.indicators.quote[0];
      const rows = chart.timestamp.map((at, i) => [new Date(at * 1000).toISOString().slice(0, 10), q.open[i], q.high[i], q.low[i], q.close[i]]);
      if (rows.length < 1000 || Date.now() - chart.timestamp.at(-1) * 1000 > 7 * 86400000) throw new Error("NQ daily history insufficient or stale");
      payload = Buffer.from(["Date,Open,High,Low,Close", ...rows.map(row => row.join(","))].join("\n"));
      break;
    } catch (error) { console.error(`${host}: ${error.message}`); }
  }
  if (!payload) throw new Error("주간 기준 원천 조회 실패: 기존 검증 기준을 보존합니다.");
  const reference = buildWeeklyReference(payload, { sourceName: "Yahoo NQ daily (cloud)" });
  if (!process.argv.includes("--check")) await fs.writeFile(output, renderReferenceModule(reference));
  console.log(`Cloud weekly reference: ${reference.effectiveFrom} ~ ${reference.effectiveThrough}`);
}
