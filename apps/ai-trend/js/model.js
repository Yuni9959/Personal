import { publicationSlot } from "./schedule.js?v=20261026.1";
export const CATEGORIES = new Set(["project", "model", "news"]);
export function validUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function validateEdition(value) {
  if (![1, 2].includes(value?.schemaVersion) || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(Date.parse(value.generatedAt)) || !Array.isArray(value.cards) || !value.cards.length || value.cards.length > 30) throw new Error("발행 데이터 형식이 올바르지 않습니다.");
  const seen = new Set();
  for (const card of value.cards) {
    if (!/^[a-f0-9]{16}$/.test(card.id) || seen.has(card.id) || !CATEGORIES.has(card.category) || !validUrl(card.url) || typeof card.title !== "string" || typeof card.summary !== "string" || !Array.isArray(card.slides) || card.slides.length !== (value.schemaVersion === 2 ? 5 : 3) || card.slides.some(s => typeof s.title !== "string" || typeof s.body !== "string") || !Array.isArray(card.tags) || !Array.isArray(card.stats)) throw new Error("카드 데이터를 검증하지 못했습니다.");
    if (value.schemaVersion === 2) {
      const ko = text => typeof text === "string" && /[가-힣]/.test(text);
      if (!ko(card.topic) || !ko(card.headline) || !ko(card.summary) || !Number.isFinite(Date.parse(card.reviewedAt)) || !Array.isArray(card.evidence) || !card.evidence.length || card.evidence.some(e => !validUrl(e.url) || typeof e.label !== "string")) throw new Error("한글 요약 또는 출처 검증 실패");
      const ids = new Set(card.evidence.map(e => e.id));
      if (ids.size !== card.evidence.length || card.slides.some(s => !ko(s.title) || !ko(s.body) || s.body.length < 100 || !Array.isArray(s.evidenceIds) || !s.evidenceIds.length || s.evidenceIds.some(id => !ids.has(id)))) throw new Error("본문과 근거 연결 검증 실패");
    }
    seen.add(card.id);
    if (card.selection && (!Number.isFinite(card.selection.score) || typeof card.selection.badge !== "string" || !Array.isArray(card.selection.signals) || !card.selection.signals.length || card.selection.signals.some(s => typeof s.label !== "string" || !validUrl(s.url)))) throw new Error("선정 근거 형식 오류");
  }
  return value;
}
export function filterCards(cards, { filter = "all", topic = "all", query = "", saved = new Set() } = {}) {
  const term = query.trim().toLocaleLowerCase();
  return cards.filter(card => (filter === "all" || (filter === "saved" ? saved.has(card.id) : filter === "research" ? card.channel === "research" : card.category === filter && (filter !== "news" || card.channel !== "research"))) && (topic === "all" || card.topic === topic) && (!term || `${card.title} ${card.headline || ""} ${card.summary} ${card.source} ${card.tags.join(" ")} ${card.slides.map(s => `${s.title} ${s.body}`).join(" ")}`.toLocaleLowerCase().includes(term)));
}
export function isOldEdition(edition, now = new Date()) {
  if (edition.publication) return Date.parse(edition.publication.scheduledAt) < Date.parse(publicationSlot(now).scheduledAt);
  return +now - Date.parse(edition.generatedAt) > 12 * 3600000;
}
