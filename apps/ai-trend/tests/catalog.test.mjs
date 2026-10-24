import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCatalog, validateCatalog, catalogCards, publicEdition } from "../js/catalog.js";
import { prepareEdition } from "../tools/prepare.mjs";
import { writeCatalog } from "../tools/catalog-store.mjs";
import { validateManifest } from "../js/schedule.js";
import { validateEdition } from "../js/model.js";
import { readPublication } from "../../../api/ai-trend.js";
import { legacyBookmarks, validBookmark } from "../js/bookmarks.js";

const original = JSON.parse(await fs.readFile(new URL("../data/latest.json", import.meta.url), "utf8"));
async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pt-catalog-test-"));
  try {
    const edition = { ...original, generatedAt: "2026-10-20T20:00:00Z" }; delete edition.collectionWarning;
    await prepareEdition(edition, root, new Date("2026-10-20T20:10:00Z"));
    const data = path.join(root, "data");
    const manifest = JSON.parse(await fs.readFile(path.join(data, "release-manifest.json"), "utf8"));
    await run({ data, manifest });
  } finally { assert.equal(path.dirname(root), os.tmpdir()); await fs.rm(root, { recursive: true }); }
}
function storageFetch(data, paths) {
  return async url => {
    const relative = new URL(url).pathname.split("/apps/ai-trend/data/")[1]; paths.push(relative);
    return { ok: true, text: () => fs.readFile(path.join(data, relative), "utf8") };
  };
}
test("정규화 색인은 반복 카드 식별을 한 번 저장하고 호별 연결만 보관한다", async () => fixture(async ({ data, manifest }) => {
  const index = validateCatalog(JSON.parse(await fs.readFile(path.join(data, manifest.catalogPath), "utf8")));
  assert.equal(index.cards.length, original.cards.length);
  assert.equal(index.releases.length, 2);
  assert.equal(index.releases.reduce((sum, r) => sum + r.cardIndexes.length, 0), 2 * original.cards.length);
  assert.equal(catalogCards(index, { ...manifest.releases[0], path: "editions/2026-10-21-07-ffffffffffffffff.json" }), null);
  index.releases[0].cardIndexes[0] = 999999;
  assert.throws(() => validateCatalog(index));
  assert.throws(() => validateManifest({ ...manifest, catalogPath: "../private.json" }));
}));
test("서버의 전체 선정 조회는 호 수에 관계없이 manifest와 색인 2회 읽기로 완료한다", async () => fixture(async ({ data }) => {
  const paths = [];
  const result = await readPublication({ now: new Date("2026-10-20T22:00:00Z"), catalogOnly: true, fetchImpl: storageFetch(data, paths) });
  assert.equal(result.complete, true); assert.equal(result.catalog.length, 2);
  assert.equal(paths.length, 2); assert.match(paths[1], /^catalogs\//);
  paths.length = 0;
  const before = await readPublication({ now: new Date("2026-10-20T21:59:59Z"), catalogOnly: true, fetchImpl: storageFetch(data, paths) });
  assert.deepEqual(before.catalog.map(e => e.id), ["2026-10-20-19"]);
}));
test("색인 손상은 SHA 검증으로 탐지하고 원본 조회로 복구한다", async () => fixture(async ({ data, manifest }) => {
  const file = path.join(data, manifest.catalogPath), index = JSON.parse(await fs.readFile(file, "utf8"));
  index.cards[0].title = "Tampered";
  await fs.writeFile(file, JSON.stringify(index));
  const paths = [], result = await readPublication({ now: new Date("2026-10-20T22:00:00Z"), catalogOnly: true, fetchImpl: storageFetch(data, paths) });
  assert.equal(result.complete, true); assert.equal(paths.length, 4);
  assert.notEqual(result.catalog[0].cards[0].title, "Tampered");
}));
test("색인이 없는 이전 저장 형식도 같은 API 계약으로 읽는다", async () => fixture(async ({ data, manifest }) => {
  delete manifest.catalogPath;
  await fs.writeFile(path.join(data, "release-manifest.json"), JSON.stringify(manifest));
  const paths = [], result = await readPublication({ now: new Date("2026-10-20T22:00:00Z"), catalogOnly: true, fetchImpl: storageFetch(data, paths) });
  assert.equal(result.complete, true); assert.equal(result.catalog.length, 2); assert.equal(paths.length, 3);
}));
test("기존 DB 색인 보강은 발행본 bytes를 보존하고 재실행해도 같은 결과다", async () => fixture(async ({ data, manifest }) => {
  const before = await Promise.all(manifest.releases.map(e => fs.readFile(path.join(data, e.path), "utf8")));
  const first = await writeCatalog(data, manifest), second = await writeCatalog(data, first);
  assert.deepEqual(first, second);
  assert.deepEqual(await Promise.all(manifest.releases.map(e => fs.readFile(path.join(data, e.path), "utf8"))), before);
  const broken = { ...manifest, releases: [...manifest.releases, { ...manifest.releases[0], id: "2026-10-22-07", scheduledAt: "2026-10-21T22:00:00.000Z", path: "editions/2026-10-22-07-ffffffffffffffff.json" }] };
  await assert.rejects(writeCatalog(data, broken));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(data, "release-manifest.json"), "utf8")), second);
}));
test("공개 읽기 모델은 수집 상태만 제외하고 카드·근거·발행 계약은 유지한다", () => {
  const value = { ...original, metricHistory: { x: [1] }, exposureHistory: { x: 1 }, candidatePool: ["internal"] };
  const projected = publicEdition(value);
  assert.equal(projected.metricHistory, undefined); assert.equal(projected.candidatePool, undefined);
  assert.deepEqual(projected.cards, value.cards); assert.equal(validateEdition(projected), projected);
  assert.ok(value.metricHistory);
});
test("기존 ID/스냅샷 이전은 유효한 개별 항목을 보존하고 손상된 항목을 격리한다", () => {
  const record = { card: original.cards[0], edition: { schemaVersion: original.schemaVersion, date: original.date, generatedAt: original.generatedAt }, savedAt: "2026-10-25T01:00:00Z" };
  const storage = { getItem: key => JSON.stringify(key.endsWith("saved-v1") ? ["ffffffffffffffff", "bad", record.card.id] : [null, { card: {} }, record]) };
  const rows = legacyBookmarks(storage);
  assert.equal(rows.length, 2); assert.ok(rows.every(validBookmark));
  assert.ok(rows.find(r => r.id === record.card.id).card);
  assert.equal(rows.find(r => r.id === "ffffffffffffffff").card, undefined);
});
