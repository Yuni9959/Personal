import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SHA256_RE = /^[0-9a-f]{64}$/;
const DEPLOYMENT_ID_RE = /^dpl_[A-Za-z0-9]+$/;
const STABLE_URL = "https://university-admission-private-preview-yuni14.vercel.app/";

function replaceExactlyOnce(text, pattern, replacement, label) {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
  if (!matches || matches.length !== 1) {
    throw new Error(`${label} marker must occur exactly once`);
  }
  return text.replace(pattern, replacement);
}

function writeIfChanged(filePath, before, after, changedFiles, relativePath) {
  if (before === after) return;
  fs.writeFileSync(filePath, after, "utf8");
  changedFiles.push(relativePath);
}

export function syncUniversityRelease({
  repoRoot,
  releaseFingerprint,
  deploymentId,
  releasedAt,
  stableUrl = STABLE_URL
}) {
  if (!SHA256_RE.test(releaseFingerprint)) throw new Error("invalid release fingerprint");
  if (!DEPLOYMENT_ID_RE.test(deploymentId)) throw new Error("invalid deployment id");
  if (stableUrl !== STABLE_URL) throw new Error("unexpected stable URL");
  const timestamp = new Date(releasedAt);
  if (!releasedAt || Number.isNaN(timestamp.valueOf())) throw new Error("invalid release timestamp");

  const root = path.resolve(repoRoot);
  const appsPath = path.join(root, "apps.js");
  const swPath = path.join(root, "sw.js");
  const appsBefore = fs.readFileSync(appsPath, "utf8");
  const swBefore = fs.readFileSync(swPath, "utf8");
  if (!appsBefore.includes(`href: "${STABLE_URL}"`)) {
    throw new Error("stable admission URL is not pinned in apps.js");
  }

  let appsAfter = replaceExactlyOnce(
    appsBefore,
    /releaseFingerprint: "[0-9a-f]{64}"/,
    `releaseFingerprint: "${releaseFingerprint}"`,
    "release fingerprint"
  );
  appsAfter = replaceExactlyOnce(
    appsAfter,
    /releaseDeploymentId: "dpl_[A-Za-z0-9]+"/,
    `releaseDeploymentId: "${deploymentId}"`,
    "release deployment id"
  );
  appsAfter = replaceExactlyOnce(
    appsAfter,
    /releasePublishedAt: "[^"]+"/,
    `releasePublishedAt: "${releasedAt}"`,
    "release timestamp"
  );
  const swAfter = replaceExactlyOnce(
    swBefore,
    /const UNIVERSITY_ADMISSION_RELEASE = "[0-9a-f]{64}";/,
    `const UNIVERSITY_ADMISSION_RELEASE = "${releaseFingerprint}";`,
    "service worker admission release"
  );

  const changedFiles = [];
  writeIfChanged(appsPath, appsBefore, appsAfter, changedFiles, "apps.js");
  writeIfChanged(swPath, swBefore, swAfter, changedFiles, "sw.js");
  return {
    status: changedFiles.length ? "updated" : "current",
    changedFiles,
    releaseFingerprint,
    deploymentId,
    releasedAt,
    stableUrl
  };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("invalid arguments");
    values[key.slice(2)] = value;
  }
  return values;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = syncUniversityRelease({
      repoRoot: args.repo,
      releaseFingerprint: args["release-fingerprint"],
      deploymentId: args["deployment-id"],
      releasedAt: args["released-at"],
      stableUrl: args["stable-url"]
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`[ERROR] ${error.message}\n`);
    process.exitCode = 1;
  }
}

export { STABLE_URL };
