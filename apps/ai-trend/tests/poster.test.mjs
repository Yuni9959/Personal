import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { posterUrl, validateEdition } from "../js/model.js";
import { encodePoster, validatePoster, validatePosterAssets } from "../tools/poster-assets.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const pixels = Buffer.from(Array.from({ length: 1080 * 1350 }, (_, i) => i % 5));
const png = encodePoster(pixels);
const image = { path: `images/${hash(png)}.png`, width: 1080, height: 1350, theme: "adobe-theme-2", alt: "검증된 본문을 요약한 이미지 카드입니다." };
test("이미지는 고정 공개 호스트·해시 경로·크기·대체 설명을 검증한다", () => {
  assert.ok(posterUrl(image).startsWith("https://raw.githubusercontent.com/Yuni9959/Personal/ai-trend-data/"));
  for (const change of [{ path: "../private.png" }, { path: "https://example.com/image.png" }, { width: 1 }, { theme: "other" }, { alt: "" }]) assert.throws(() => posterUrl({ ...image, ...change }));
  const edition = { schemaVersion: 1, date: "2026-10-26", generatedAt: "2026-10-26T00:00:00Z", cards: [{ id: "1234567890abcdef", category: "news", url: "https://example.com", title: "기사", summary: "요약", tags: [], stats: [], slides: Array.from({ length: 3 }, () => ({ title: "제목", body: "원문" })) }] };
  assert.equal(validateEdition(edition), edition);
  edition.cards[0].slides[0].image = image; assert.equal(validateEdition(edition), edition);
  edition.cards[0].slides[0].image = null; assert.throws(() => validateEdition(edition));
});
test("PNG의 픽셀·다섯 색·해시·CRC를 확인하고 손상과 다른 색을 거부한다", () => {
  assert.deepEqual(validatePoster(png, hash(png)), { width: 1080, height: 1350, colors: 5, bytes: png.length });
  assert.throws(() => validatePoster(png, "0".repeat(64)), /hash/);
  const damaged = Buffer.from(png); damaged[45] ^= 1;
  assert.throws(() => validatePoster(damaged, hash(damaged)), /CRC/);
  const oneColor = encodePoster(Buffer.alloc(1080 * 1350));
  assert.throws(() => validatePoster(oneColor, hash(oneColor)), /five/);
  const bad = Buffer.from(pixels); bad[5000] = 5; assert.throws(() => encodePoster(bad), /pixels/);
});
test("발행 전 이미지 누락·내용 변경을 거부하며 구형 텍스트 호는 허용한다", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pt-poster-test-"));
  try {
    const editions = [{ cards: [{ slides: [{ image }] }] }];
    assert.equal(await validatePosterAssets(dir, [{ cards: [{ slides: [{}] }] }]), 0);
    await assert.rejects(validatePosterAssets(dir, editions), /ENOENT/);
    await fs.mkdir(path.join(dir, "images")); await fs.writeFile(path.join(dir, image.path), png);
    assert.equal(await validatePosterAssets(dir, editions), 1);
    await fs.writeFile(path.join(dir, image.path), "corrupt"); await assert.rejects(validatePosterAssets(dir, editions), /hash/);
    await assert.rejects(validatePosterAssets(dir, [{ cards: [{ slides: [{ image: { path: "../escape.png" } }] }] }]), /path/);
  } finally { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); await fs.rm(dir, { recursive: true, force: true }); }
});
