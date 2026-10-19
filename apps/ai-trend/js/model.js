export const CATEGORIES = new Set(["project", "model", "news"]);
export function validUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function validateEdition(value) {
  if (value?.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(Date.parse(value.generatedAt)) || !Array.isArray(value.cards) || !value.cards.length || value.cards.length > 30) throw new Error("발행 데이터 형식이 올바르지 않습니다.");
  const seen = new Set();
  for (const card of value.cards) {
    if (!/^[a-f0-9]{16}$/.test(card.id) || seen.has(card.id) || !CATEGORIES.has(card.category) || !validUrl(card.url) || typeof card.title !== "string" || typeof card.summary !== "string" || !Array.isArray(card.slides) || card.slides.length !== 3 || card.slides.some(s => typeof s.title !== "string" || typeof s.body !== "string") || !Array.isArray(card.tags) || !Array.isArray(card.stats)) throw new Error("카드 데이터를 검증하지 못했습니다.");
    seen.add(card.id);
  }
  return value;
}
export function filterCards(cards, { filter = "all", query = "", saved = new Set() } = {}) {
  const term = query.trim().toLocaleLowerCase();
  return cards.filter(card => (filter === "all" || (filter === "saved" ? saved.has(card.id) : card.category === filter)) && (!term || `${card.title} ${card.summary} ${card.source} ${card.tags.join(" ")}`.toLocaleLowerCase().includes(term)));
}
export function isOldEdition(edition, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return edition.date < today;
}
