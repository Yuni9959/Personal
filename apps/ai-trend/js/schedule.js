// KST has no daylight-saving time. Publication slots are 07:00 and 19:00 KST.
export const INTERVAL = 12 * 3600000;
const ANCHOR = Date.parse("2026-01-01T22:00:00Z");
export function publicationSlot(now = new Date(), next = false) {
  const time = +new Date(now);
  if (!Number.isFinite(time)) throw new Error("Invalid publication clock");
  const at = ANCHOR + (Math.floor((time - ANCHOR) / INTERVAL) + Number(next)) * INTERVAL;
  const local = new Date(at + 9 * 3600000).toISOString();
  return { id: `${local.slice(0, 10)}-${local.slice(11, 13)}`, scheduledAt: new Date(at).toISOString() };
}
export function validateManifest(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.releases) || value.releases.length > 64) throw new Error("발행 색인 오류");
  const ids = new Set();
  for (const entry of value.releases) {
    if (!/^\d{4}-\d{2}-\d{2}-(07|19)$/.test(entry.id) || ids.has(entry.id) ||
      publicationSlot(entry.scheduledAt).id !== entry.id ||
      publicationSlot(entry.scheduledAt).scheduledAt !== entry.scheduledAt ||
      !Number.isFinite(Date.parse(entry.preparedAt)) ||
      !new RegExp(`^editions/${entry.id}-[a-f0-9]{16}\\.json$`).test(entry.path)) throw new Error("발행 일정 검증 실패");
    ids.add(entry.id);
  }
  return value;
}
export function releasedEntries(manifest, now = new Date()) {
  return validateManifest(manifest).releases.filter(e => Date.parse(e.scheduledAt) <= +now && Date.parse(e.preparedAt) <= +now)
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
}
export function resolvePublication(manifest, now = new Date(), selected = "latest") {
  const releases = releasedEntries(manifest, now);
  const expected = publicationSlot(now), next = publicationSlot(now, true);
  const entry = selected === "latest" ? releases[0] : releases.find(e => e.id === selected);
  return { serverNow: new Date(now).toISOString(), expected, nextPublishAt: next.scheduledAt,
    delayed: !releases.length || releases[0].id !== expected.id, entry: entry || null,
    releases: releases.map(({ id, scheduledAt, preparedAt }) => ({ id, scheduledAt, preparedAt })) };
}
export function editionForRelease(edition, entry) {
  if (edition.publication?.id !== entry.id || edition.publication?.scheduledAt !== entry.scheduledAt ||
    edition.publication?.preparedAt !== entry.preparedAt || edition.date !== entry.id.slice(0, 10)) throw new Error("발행본과 예약 정보가 일치하지 않습니다.");
  return edition;
}
