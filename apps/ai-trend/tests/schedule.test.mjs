import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { publicationSlot, resolvePublication, validateManifest } from "../js/schedule.js";
import { isOldEdition } from "../js/model.js";
import { prepareEdition } from "../tools/prepare.mjs";
import handler, { readPublication } from "../../../api/ai-trend.js";
import { validBookmark } from "../js/bookmarks.js";
import { editionLabel, occurrenceFor } from "../js/library.js";

const original = JSON.parse(await fs.readFile(new URL("../data/latest.json", import.meta.url), "utf8"));
function fixture(at) {
  const edition = structuredClone(original);
  edition.generatedAt = at;
  delete edition.collectionWarning;
  return edition;
}
async function prepared(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pt-scheduled-test-"));
  try { await run(root); } finally { await fs.rm(root, { recursive: true }); }
}
const readManifest = async root => JSON.parse(await fs.readFile(path.join(root, "data/release-manifest.json"), "utf8"));

test("추가 발행은 기존 공개 호를 보존하고 정확히 한 호만 추가하며 조회·저장·순서를 유지한다", async () => prepared(async root => {
  const at = new Date("2026-10-26T04:30:12.123Z");
  await prepareEdition(fixture("2026-10-25T20:00:00Z"), root, new Date("2026-10-25T20:10:00Z"));
  const before = await readManifest(root);
  const originalBytes = await Promise.all(before.releases.map(e => fs.readFile(path.join(root, "data", e.path), "utf8")));
  const added = await prepareEdition(fixture(at.toISOString()), root, at, { manual: true });
  assert.equal(added.length, 1); assert.equal(added[0].id, "2026-10-26-133012123");
  const after = await readManifest(root);
  assert.equal(after.releases.length, before.releases.length + 1);
  assert.deepEqual(await Promise.all(before.releases.map(e => fs.readFile(path.join(root, "data", e.path), "utf8"))), originalBytes);
  const fetchImpl = async url => ({ ok: true, text: () => fs.readFile(path.join(root, "data", new URL(url).pathname.split("/apps/ai-trend/data/")[1]), "utf8") });
  const result = await readPublication({ now: at, fetchImpl });
  assert.equal(result.entry.id, added[0].id); assert.equal(result.delayed, false);
  assert.equal(result.nextPublishAt, "2026-10-26T10:00:00.000Z");
  assert.equal(isOldEdition(result.edition, at), false); assert.match(editionLabel(result.edition), /추가호 13:30/);
  assert.equal(validBookmark({ id: result.edition.cards[0].id, card: result.edition.cards[0], edition: result.edition, savedAt: at.toISOString() }), true);
  await assert.rejects(readPublication({ now: new Date(+at - 1), selected: added[0].id, fetchImpl }));
  const catalog = await readPublication({ now: at, fetchImpl, catalogOnly: true });
  assert.equal(catalog.complete, true); assert.equal(catalog.catalog[0].id, added[0].id);
  assert.equal(occurrenceFor(result.edition.cards[0], "2026-10-26-07", catalog.catalog).count, 2);
  await assert.rejects(prepareEdition(fixture(at.toISOString()), root, at, { manual: true }), /이미 존재/);
}));

test("KST 07:00 / 19:00 직전과 정각, 자정 및 연말의 발행 경계를 지킨다", () => {
  for (const [at, id] of [
    ["2026-10-20T21:59:59.999Z", "2026-10-20-19"],
    ["2026-10-20T22:00:00.000Z", "2026-10-21-07"],
    ["2026-10-21T09:59:59.999Z", "2026-10-21-07"],
    ["2026-10-21T10:00:00.000Z", "2026-10-21-19"],
    ["2026-10-21T15:00:00.000Z", "2026-10-21-19"],
    ["2026-12-31T22:00:00.000Z", "2027-01-01-07"]
  ]) assert.equal(publicationSlot(new Date(at)).id, id);
});
test("사전 준비는 공개하지 않으며 정각에 서버가 다음 발행본으로 바꾼다", async () => prepared(async root => {
  await prepareEdition(fixture("2026-10-20T20:00:00Z"), root, new Date("2026-10-20T20:10:00Z"));
  const manifest = await readManifest(root);
  const before = resolvePublication(manifest, new Date("2026-10-20T21:59:59Z"));
  assert.equal(before.entry.id, "2026-10-20-19");
  assert.equal(before.releases.length, 1);
  assert.equal(resolvePublication(manifest, new Date("2026-10-20T21:59:59Z"), "2026-10-21-07").entry, null);
  const after = resolvePublication(manifest, new Date("2026-10-20T22:00:00Z"));
  assert.equal(after.entry.id, "2026-10-21-07");
  assert.equal(after.delayed, false);
  assert.equal(after.releases.length, 2);
  assert.equal(after.nextPublishAt, "2026-10-21T10:00:00.000Z");
  assert.equal(isOldEdition({ publication: after.entry }, new Date("2026-10-21T09:59:59Z")), false);
  assert.equal(isOldEdition({ publication: after.entry }, new Date("2026-10-21T10:00:00Z")), true);
}));
test("발행 후에는 본문을 덮어쓰지 않고 같은 날 아침·저녁을 따로 보관한다", async () => prepared(async root => {
  await prepareEdition(fixture("2026-10-20T20:00:00Z"), root, new Date("2026-10-20T20:10:00Z"));
  const first = await readManifest(root);
  await prepareEdition(fixture("2026-10-20T21:00:00Z"), root, new Date("2026-10-20T21:10:00Z"));
  const second = await readManifest(root);
  assert.equal(first.releases[1].path, second.releases[1].path);
  assert.notEqual(first.releases[0].path, second.releases[0].path);
  await prepareEdition(fixture("2026-10-21T08:00:00Z"), root, new Date("2026-10-21T08:10:00Z"));
  const third = await readManifest(root);
  assert.equal(second.releases[0].path, third.releases.find(e => e.id === "2026-10-21-07").path);
  assert.equal(third.releases.filter(e => e.id.startsWith("2026-10-21")).length, 2);
}));
test("다음 호 누락·수집 실패·오래된 수집을 새 발행 성공으로 바꾸지 않는다", async () => prepared(async root => {
  await prepareEdition(fixture("2026-10-20T20:00:00Z"), root, new Date("2026-10-20T20:10:00Z"));
  const before = await readManifest(root);
  const missing = resolvePublication(before, new Date("2026-10-21T10:00:00Z"));
  assert.equal(missing.delayed, true);
  assert.equal(missing.entry.id, "2026-10-21-07");
  await assert.rejects(prepareEdition({ ...fixture("2026-10-21T08:00:00Z"), collectionWarning: "보관본" }, root, new Date("2026-10-21T08:10:00Z")));
  await assert.rejects(prepareEdition(fixture("2026-10-19T08:00:00Z"), root, new Date("2026-10-21T08:10:00Z")));
  assert.deepEqual(await readManifest(root), before);
}));
test("서버는 데이터 브랜치를 읽고 미래 발행 요청·일정 변조·파일 불일치를 거부한다", async () => prepared(async root => {
  await prepareEdition(fixture("2026-10-20T20:00:00Z"), root, new Date("2026-10-20T20:10:00Z"));
  const urls = [];
  const fetchImpl = async (url, options) => {
    urls.push(url);
    assert.equal(options.cache, "no-store");
    const relative = new URL(url).pathname.split("/apps/ai-trend/data/")[1];
    return { ok: true, text: () => fs.readFile(path.join(root, "data", relative), "utf8") };
  };
  const result = await readPublication({ now: new Date("2026-10-20T22:00:00Z"), fetchImpl });
  assert.equal(result.edition.publication.id, "2026-10-21-07");
  assert.ok(urls.every(u => u.includes("/ai-trend-data/")));
  await assert.rejects(readPublication({ now: new Date("2026-10-20T21:59:59Z"), selected: "2026-10-21-07", fetchImpl }));
  const manifest = await readManifest(root);
  manifest.releases[0].path = "../private.json";
  assert.throws(() => validateManifest(manifest));
  manifest.releases[0].path = "editions/2026-10-21-07-aaaaaaaaaaaaaaaa.json";
  manifest.releases[0].scheduledAt = "2026-10-20T22:01:00.000Z";
  assert.throws(() => validateManifest(manifest));
}));
test("서버 응답은 CDN에 저장되지 않고 허용하지 않은 Origin을 거부한다", async () => {
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; }, status(n) { this.code = n; return this; }, json(v) { this.body = v; }, end() {} };
  await handler({ method: "GET", headers: { origin: "https://invalid.example" }, url: "/api/ai-trend" }, res);
  assert.equal(res.code, 403);
  assert.equal(headers["Cache-Control"], "no-store, max-age=0");
  assert.equal(headers["Vercel-CDN-Cache-Control"], "no-store");
});

test("중복 색인은 공개된 호만 포함하고 손상·누락은 부분 확인으로 명시한다", async () => prepared(async root => {
  await prepareEdition(fixture("2026-10-20T20:00:00Z"), root, new Date("2026-10-20T20:10:00Z"));
  let fail = false;
  const fetchImpl = async url => {
    const relative = new URL(url).pathname.split("/apps/ai-trend/data/")[1];
    if (fail && (relative.startsWith("catalogs/") || relative.startsWith("editions/2026-10-20"))) throw new Error("unavailable");
    return { ok: true, text: () => fs.readFile(path.join(root, "data", relative), "utf8") };
  };
  const before = await readPublication({ now: new Date("2026-10-20T21:59:59Z"), fetchImpl, catalogOnly: true });
  assert.equal(before.complete, true);
  assert.deepEqual(before.catalog.map(e => e.id), ["2026-10-20-19"]);
  assert.equal(before.catalog[0].cards[0].slides, undefined);
  const after = await readPublication({ now: new Date("2026-10-20T22:00:00Z"), fetchImpl, catalogOnly: true });
  assert.equal(after.catalog.length, 2);
  fail = true;
  const partial = await readPublication({ now: new Date("2026-10-20T22:00:00Z"), fetchImpl, catalogOnly: true });
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missing, ["2026-10-20-19"]);
  assert.equal(partial.catalog.length, 1);
}));
