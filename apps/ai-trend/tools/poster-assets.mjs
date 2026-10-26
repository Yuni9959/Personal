import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { POSTER_THEMES } from "../js/model.js";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function paletteFor(theme) {
  if (!Object.hasOwn(POSTER_THEMES, theme)) throw new Error("Unknown poster theme");
  return Buffer.from(POSTER_THEMES[theme].join("").replaceAll("#", ""), "hex");
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
export function encodePoster(indices, theme = "adobe-theme-2") {
  const palette = paletteFor(theme);
  if (indices.length !== 1080 * 1350 || indices.some(n => n > 4)) throw new Error("Invalid poster pixels");
  const header = Buffer.alloc(13); header.writeUInt32BE(1080); header.writeUInt32BE(1350, 4); header[8] = 8; header[9] = 3;
  const rows = Buffer.alloc(1081 * 1350);
  for (let y = 0; y < 1350; y++) indices.copy(rows, y * 1081 + 1, y * 1080, (y + 1) * 1080);
  return Buffer.concat([signature, chunk("IHDR", header), chunk("PLTE", palette), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
// Our renderer emits a deliberately narrow indexed PNG format: exactly five opaque colors.
export function validatePoster(bytes, expectedHash, theme = "adobe-theme-2") {
  const palette = paletteFor(theme);
  if (bytes.length > 4 * 1024 * 1024 || !bytes.subarray(0, 8).equals(signature) || createHash("sha256").update(bytes).digest("hex") !== expectedHash) throw new Error("Poster hash/signature mismatch");
  const chunks = []; let offset = 8;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("Truncated poster");
    const size = bytes.readUInt32BE(offset), end = offset + size + 12;
    if (end > bytes.length || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new Error("Poster CRC mismatch");
    chunks.push({ type: bytes.toString("ascii", offset + 4, offset + 8), data: bytes.subarray(offset + 8, end - 4) }); offset = end;
  }
  if (chunks.map(c => c.type).join() !== "IHDR,PLTE,IDAT,IEND") throw new Error("Unexpected poster format");
  const [header, colors, compressed, end] = chunks.map(c => c.data);
  if (header.length !== 13 || header.readUInt32BE(0) !== 1080 || header.readUInt32BE(4) !== 1350 || !header.subarray(8).equals(Buffer.from([8, 3, 0, 0, 0])) || !colors.equals(palette) || end.length) throw new Error("Poster dimensions/palette mismatch");
  const rows = inflateSync(compressed, { maxOutputLength: 1081 * 1350 });
  if (rows.length !== 1081 * 1350) throw new Error("Poster pixel count mismatch");
  const used = new Set();
  for (let y = 0; y < 1350; y++) {
    if (rows[y * 1081] !== 0) throw new Error("Unexpected poster filter");
    for (let x = 1; x <= 1080; x++) { const n = rows[y * 1081 + x]; if (n > 4) throw new Error("Unexpected poster color"); used.add(n); }
  }
  if (used.size !== 5) throw new Error("Poster must use all five theme colors");
  return { width: 1080, height: 1350, colors: 5, bytes: bytes.length };
}
export async function validatePosterAssets(data, editions) {
  const images = editions.flatMap(e => e.cards.flatMap(c => c.slides.flatMap(s => s.image ? [s.image] : [])));
  const checked = new Set();
  for (const image of images) {
    const name = image.path, key = `${name}:${image.theme}`;
    if (checked.has(key)) continue;
    if (!/^images\/[a-f0-9]{64}\.png$/.test(name)) throw new Error("Invalid poster path");
    validatePoster(await fs.readFile(path.join(data, name)), name.slice(7, -4), image.theme);
    checked.add(key);
  }
  return new Set(images.map(image => image.path)).size;
}
