import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("Volatility refresh deploy is fail-closed and only stages generated market files", () => {
  const script = read("apps/volatility/tools/refresh-and-deploy.ps1");
  assert.match(script, /npm run sync:volatility-data/);
  assert.match(script, /npm run test:release/);
  assert.match(script, /@\("-C", \$repo, "add", "--"\) \+ \$allowedFiles/);
  assert.match(script, /Invoke-Checked -Program "git" -Arguments \$gitAddArguments/);
  assert.match(script, /push origin main/);
  assert.match(script, /unrelated tracked changes/);
  assert.match(script, /PersonalTapVolatilityRefresh/);
  assert.match(script, /local-nasdaq-snapshot\.json/);
  assert.match(script, /weekly-reference\.generated\.js/);
});

test("generated weekly reference and local snapshot use a network-first cache route", () => {
  const serviceWorker = read("sw.js");
  const routeStart = serviceWorker.indexOf("const VOLATILITY_REFRESHABLE_PATHS");
  const navigationStart = serviceWorker.indexOf('if (request.mode === "navigate")');
  assert.ok(routeStart >= 0 && navigationStart > routeStart);
  const route = serviceWorker.slice(routeStart, navigationStart);
  assert.match(route, /local-nasdaq-snapshot\.json/);
  assert.match(route, /weekly-reference\.generated\.js/);
  assert.match(route, /cache: "no-store"/);
  assert.match(route, /caches\.match\(request\)/);
});
