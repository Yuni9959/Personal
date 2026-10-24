import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { validateManifest, editionForRelease } from "../apps/ai-trend/js/schedule.js";
import { validateEdition } from "../apps/ai-trend/js/model.js";
import { createCatalog, validateCatalog } from "../apps/ai-trend/js/catalog.js";
import { writeCatalog } from "../apps/ai-trend/tools/catalog-store.mjs";
import { createHash } from "node:crypto";

// Public data has its own branch. Updating it never triggers the main-only app
// deployment. Credentials remain in the existing local/Actions Git stores.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "apps/ai-trend/data/";
const BRANCH = "ai-trend-data";
const BASE_FILE = path.join(ROOT, ".tmp/ai-trend-store-base.json");
const exec = promisify(execFile);
const allowed = name => name.startsWith(PREFIX) && /^[a-zA-Z0-9/_.-]+\.json$/.test(name) && !name.split("/").includes("..");
async function git(args, cwd = ROOT, encoding = "utf8") {
  return (await exec("git", ["-c", `safe.directory=${cwd.replaceAll("\\", "/")}`, ...args], { cwd, windowsHide: true, encoding, maxBuffer: 16 * 1024 * 1024, timeout: 120000 })).stdout;
}
async function base() {
  try {
    await git(["ls-remote", "--exit-code", "origin", `refs/heads/${BRANCH}`]);
  } catch (error) { if (error.code === 2) return null; throw error; }
  await git(["fetch", "origin", `${BRANCH}:refs/remotes/origin/${BRANCH}`]);
  return (await git(["rev-parse", `origin/${BRANCH}`])).trim();
}
async function files(ref, cwd = ROOT) {
  const names = (await git(["ls-tree", "-r", "--name-only", ref, "--", PREFIX], cwd)).trim().split("\n").filter(Boolean);
  if (names.some(name => !allowed(name))) throw new Error("Unexpected path in data store");
  return names;
}
async function pull() {
  const ref = await base();
  await fs.mkdir(path.dirname(BASE_FILE), { recursive: true });
  await fs.writeFile(BASE_FILE, JSON.stringify({ ref }));
  if (!ref) { console.log("Data branch will be initialized on first push."); return; }
  for (const name of await files(ref)) {
    await fs.mkdir(path.dirname(path.join(ROOT, name)), { recursive: true });
    await fs.writeFile(path.join(ROOT, name), await git(["show", `${ref}:${name}`], ROOT, "buffer"));
  }
  console.log(`Loaded public editorial data ${ref.slice(0, 12)}`);
}
async function push() {
  const data = path.join(ROOT, PREFIX);
  const manifest = validateManifest(JSON.parse(await fs.readFile(path.join(data, "release-manifest.json"), "utf8")));
  const editions = [];
  for (const entry of manifest.releases) {
    const edition = editionForRelease(validateEdition(JSON.parse(await fs.readFile(path.join(data, entry.path), "utf8"))), entry);
    editions.push({ entry, edition });
  }
  if (manifest.catalogPath) {
    const text = await fs.readFile(path.join(data, manifest.catalogPath), "utf8");
    if (createHash("sha256").update(text).digest("hex") !== manifest.catalogPath.slice(9, -5) || JSON.stringify(validateCatalog(JSON.parse(text))) !== JSON.stringify(createCatalog(editions))) throw new Error("Publication index does not match immutable editions");
  }
  const current = await base();
  let loaded;
  try { loaded = JSON.parse(await fs.readFile(BASE_FILE, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (loaded && loaded.ref !== current) throw new Error("Data changed during preparation; retry from a fresh data snapshot");
  const ref = current || (await git(["rev-parse", "origin/main"])).trim();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "pt-data-store-"));
  // mkdtemp is an empty directory; worktree accepts it. Remove only files that
  // Git identified under the fixed public-data prefix, never a computed tree.
  await git(["worktree", "add", "--detach", work, ref]);
  try {
    for (const name of await files("HEAD", work)) await fs.unlink(path.join(work, name));
    await fs.cp(data, path.join(work, PREFIX), { recursive: true });
    await git(["add", "--", PREFIX], work);
    const names = (await git(["diff", "--cached", "--name-only"], work)).trim().split("\n").filter(Boolean);
    if (names.some(name => !allowed(name))) throw new Error("Data-only publication refused");
    if (names.length) {
      await git(["-c", "user.name=Personal Tap Publisher", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit", "-m", "data: prepare scheduled AI Trend editions"], work);
      // A concurrent writer causes rejection; never force-push generated data.
      await git(["push", "origin", `HEAD:refs/heads/${BRANCH}`], work);
    }
    console.log(`Prepared data stored at ${(await git(["rev-parse", "HEAD"], work)).trim()}; no app deployment requested.`);
  } finally {
    await git(["worktree", "remove", work]);
  }
}
async function verify() {
  const expected = validateManifest(JSON.parse(await fs.readFile(path.join(ROOT, PREFIX, "release-manifest.json"), "utf8")));
  const next = expected.releases[0];
  let failure = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(`https://personal-tap-data-yuni14.vercel.app/api/ai-trend?status=1&t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const status = await response.json();
      if (!status.ready?.some(e => e.id === next.id && e.preparedAt === next.preparedAt)) throw new Error("Server has not observed the prepared edition");
      if (expected.catalogPath && status.catalogPath !== expected.catalogPath) throw new Error("Server has not observed the publication index");
      console.log(`Server confirmed ${next.id}, prepared ${next.preparedAt}. Release remains gated by server time.`);
      return;
    } catch (error) { failure = error.message; }
    if (attempt < 5) await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error(`Server readiness verification failed: ${failure}`);
}
async function index() {
  const data = path.join(ROOT, PREFIX);
  const manifest = JSON.parse(await fs.readFile(path.join(data, "release-manifest.json"), "utf8"));
  const indexed = await writeCatalog(data, manifest);
  console.log(`Indexed ${indexed.releases.length} editions at ${indexed.catalogPath}; published bodies unchanged.`);
}
const commands = { pull, index, push, verify };
if (!commands[process.argv[2]]) throw new Error("Expected pull, index, push, or verify");
await commands[process.argv[2]]();
