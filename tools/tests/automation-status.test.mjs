import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
test("자동화 상태 분류와 로컬 접근 제한을 검증한다", () => {
  const result = spawnSync(process.platform === "win32" ? "py" : "python3",
    [fileURLToPath(new URL("./test_automation_status.py", import.meta.url))], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
