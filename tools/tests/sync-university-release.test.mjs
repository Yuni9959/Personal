import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { STABLE_URL, syncUniversityRelease } from "../sync-university-release.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-tap-admission-sync-"));
  fs.writeFileSync(path.join(root, "apps.js"), `window.PERSONAL_TAP_APPS = [{
  id: "university-admission",
  href: "${STABLE_URL}",
  releaseFingerprint: "${"1".repeat(64)}",
  releaseDeploymentId: "dpl_Old123",
  releasePublishedAt: "2026-08-01T00:00:00Z"
}];\n`);
  fs.writeFileSync(path.join(root, "sw.js"), `const UNIVERSITY_ADMISSION_RELEASE = "${"1".repeat(64)}";\n`);
  return root;
}

test("입시 release fingerprint를 PT 카드와 Service Worker에 멱등 동기화한다", () => {
  const root = fixture();
  try {
    const releaseFingerprint = "a".repeat(64);
    const options = {
      repoRoot: root,
      releaseFingerprint,
      deploymentId: "dpl_Current456",
      releasedAt: "2026-08-30T00:01:29Z",
      stableUrl: STABLE_URL
    };
    const first = syncUniversityRelease(options);
    assert.deepEqual(first.changedFiles, ["apps.js", "sw.js"]);
    assert.match(fs.readFileSync(path.join(root, "apps.js"), "utf8"), new RegExp(releaseFingerprint));
    assert.match(fs.readFileSync(path.join(root, "sw.js"), "utf8"), new RegExp(releaseFingerprint));
    assert.equal(syncUniversityRelease(options).status, "current");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("잘못된 fingerprint나 stable URL은 파일을 바꾸기 전에 거부한다", () => {
  const root = fixture();
  try {
    const before = fs.readFileSync(path.join(root, "apps.js"), "utf8");
    assert.throws(() => syncUniversityRelease({
      repoRoot: root,
      releaseFingerprint: "bad",
      deploymentId: "dpl_Current456",
      releasedAt: "2026-08-30T00:01:29Z",
      stableUrl: STABLE_URL
    }), /invalid release fingerprint/);
    assert.throws(() => syncUniversityRelease({
      repoRoot: root,
      releaseFingerprint: "a".repeat(64),
      deploymentId: "dpl_Current456",
      releasedAt: "2026-08-30T00:01:29Z",
      stableUrl: "https://example.com/"
    }), /unexpected stable URL/);
    assert.equal(fs.readFileSync(path.join(root, "apps.js"), "utf8"), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
