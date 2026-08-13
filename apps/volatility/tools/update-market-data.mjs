import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchYahooSnapshot } from "../js/market-provider.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(here, "..", "data", "market.json");
const allowStale = process.argv.includes("--allow-stale");

try {
  const snapshot = await fetchYahooSnapshot(async (url, options) => fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      "User-Agent": "Personal-Tap-Market-Snapshot/1.0"
    }
  }));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`Updated ${outputPath}`);
  console.log(`${snapshot.provider.returnedSymbol} ${snapshot.session.label} ${snapshot.market.latestBarAt}`);
} catch (error) {
  if (allowStale) {
    try {
      await fs.access(outputPath);
      console.warn(`Market refresh failed; keeping the existing snapshot: ${error.message}`);
      process.exitCode = 0;
    } catch {
      console.error(`Market refresh failed and no fallback snapshot exists: ${error.message}`);
      process.exitCode = 1;
    }
  } else {
    console.error(error);
    process.exitCode = 1;
  }
}
