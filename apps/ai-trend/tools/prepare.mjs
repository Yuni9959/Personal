import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateEdition } from "../js/model.js";
import { publicationSlot, additionalPublication, validateManifest } from "../js/schedule.js";
import { atomicWrite, writeCatalog } from "./catalog-store.mjs";

// Preparing a file does not publish it. Only the server's clock opens a slot.
export async function prepareEdition(edition, root, now = new Date(), { manual = false } = {}) {
  validateEdition(edition);
  if (edition.schemaVersion !== 2 || edition.collectionWarning ||
    +now - Date.parse(edition.generatedAt) > 12 * 3600000 ||
    Date.parse(edition.generatedAt) > +now + 60000) throw new Error("새 수집이 검증되지 않아 예약 발행본을 보존합니다.");
  const data = path.join(root, "data");
  const file = path.join(data, "release-manifest.json");
  let manifest = { schemaVersion: 1, releases: [] };
  try { manifest = validateManifest(JSON.parse(await fs.readFile(file, "utf8"))); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  await fs.mkdir(path.join(data, "editions"), { recursive: true });
  const prepared = [];
  for (const slot of manual ? [additionalPublication(now)] : [publicationSlot(now), publicationSlot(now, true)]) {
    const existing = manifest.releases.find(e => e.id === slot.id);
    if (existing && manual) throw new Error("동일 추가호가 이미 존재합니다.");
    // Published editions are immutable; a late first edition is marked as late.
    if (existing && Date.parse(slot.scheduledAt) <= +now) continue;
    const publication = { ...slot, preparedAt: now.toISOString() };
    const release = { ...edition, date: slot.id.slice(0, 10), publication };
    const encoded = `${JSON.stringify(release, null, 2)}\n`;
    const hash = createHash("sha256").update(encoded).digest("hex").slice(0, 16);
    const entry = { ...publication, path: `editions/${slot.id}-${hash}.json` };
    await atomicWrite(path.join(data, entry.path), encoded);
    manifest.releases = [...manifest.releases.filter(e => e.id !== slot.id), entry];
    prepared.push(entry);
  }
  manifest.releases = manifest.releases.filter(e => Date.parse(e.scheduledAt) > +now - 30 * 86400000)
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  validateManifest(manifest);
  await writeCatalog(data, manifest);
  // Keep only files referenced by the manifest. Git publishes both atomically.
  const active = new Set(manifest.releases.map(e => path.basename(e.path)));
  for (const name of await fs.readdir(path.join(data, "editions"))) {
    if (/^\d{4}-\d{2}-\d{2}-(?:07|19|\d{9})-[a-f0-9]{16}\.json$/.test(name) && !active.has(name)) await fs.unlink(path.join(data, "editions", name));
  }
  return prepared;
}
