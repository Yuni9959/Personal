import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadQuestionBank } from "../js/bank-loader.js";
import { hashString, shuffled } from "../js/random.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..", "..");
const mensaRoot = path.join(projectRoot, "apps", "mensa");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("기존 seed 기반 무작위 함수의 결과를 유지한다", () => {
  const source = ["a", "b", "c", "d", "e"];
  assert.equal(hashString("daily-2026-07-25"), 3336960107);
  assert.deepEqual(shuffled(source, 12345), ["a", "c", "d", "b", "e"]);
  assert.deepEqual(source, ["a", "b", "c", "d", "e"]);
});

test("브라우저 문제은행 로더가 JSON v2를 검사해 반환한다", async () => {
  const bank = JSON.parse(read("apps/mensa/data/question-bank.json"));
  const loaded = await loadQuestionBank(async url => {
    assert.match(String(url), /apps\/mensa\/data\/question-bank\.json$/);
    return {
      ok: true,
      status: 200,
      json: async () => bank
    };
  });

  assert.equal(loaded.bankVersion, bank.bankVersion);
  assert.equal(loaded.questions.length, 125);
});

test("HTML의 모든 로컬 href와 src가 존재한다", () => {
  const htmlFiles = ["index.html", "apps/mensa/index.html"];

  for (const relativeHtmlPath of htmlFiles) {
    const html = read(relativeHtmlPath);
    const sourceDirectory = path.dirname(path.join(projectRoot, relativeHtmlPath));
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
      .map(match => match[1])
      .filter(ref => !/^(?:https?:|#)/.test(ref));

    for (const ref of refs) {
      const cleanRef = ref.split(/[?#]/)[0];
      const resolved = path.resolve(sourceDirectory, cleanRef);
      assert.ok(fs.existsSync(resolved), `${relativeHtmlPath} → ${ref}`);
    }
  }
});

test("MKAT는 JSON과 ES 모듈만 사용하고 v1 실행 파일은 제거됐다", () => {
  const html = read("apps/mensa/index.html");
  assert.match(html, /type="module" src="\.\/js\/app\.js"/);
  assert.doesNotMatch(html, /question-bank\.js/);
  assert.equal(fs.existsSync(path.join(mensaRoot, "question-bank.js")), false);
  assert.equal(fs.existsSync(path.join(mensaRoot, "app.js")), false);
});

test("Service Worker 핵심 자산과 업데이트 정책이 Foundation 규칙을 따른다", () => {
  const source = read("sw.js");
  const assetBlock = source.match(/const CORE_ASSETS = \[(.*?)\];/s)?.[1] || "";
  const assets = [...assetBlock.matchAll(/"([^"]+)"/g)].map(match => match[1]);

  assert.ok(assets.includes("./apps/mensa/data/question-bank.json"));
  assert.ok(assets.includes("./apps/mensa/js/app.js"));
  assert.ok(assets.includes("./pwa-update.js"));
  assert.ok(!assets.some(asset => asset.endsWith("question-bank.js")));

  for (const asset of assets) {
    const relativePath = asset.replace(/^\.\//, "");
    assert.ok(fs.existsSync(path.join(projectRoot, relativePath)), asset);
  }

  const installBlock = source.match(
    /self\.addEventListener\("install".*?\n\}\);/s
  )?.[0] || "";
  assert.doesNotMatch(installBlock, /skipWaiting/);
  assert.match(source, /key\.startsWith\(CACHE_PREFIX\)/);
  assert.match(source, /url\.origin !== scopeUrl\.origin/);
  assert.match(source, /url\.pathname\.startsWith\(scopeUrl\.pathname\)/);
  assert.match(source, /event\.data\?\.type === "SKIP_WAITING"/);
});
