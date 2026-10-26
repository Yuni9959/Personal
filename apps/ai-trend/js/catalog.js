import { identityCard } from "./library.js";
import { validReleaseId } from "./schedule.js";

export function createCatalog(editions) {
  const cards = [], keys = new Map();
  const releases = [...editions].sort((a, b) => b.entry.id.localeCompare(a.entry.id)).map(({ entry, edition }) => ({
    id: entry.id, path: entry.path,
    cardIndexes: edition.cards.map(card => {
      const identity = identityCard(card), key = JSON.stringify(identity);
      if (!keys.has(key)) { keys.set(key, cards.length); cards.push(identity); }
      return keys.get(key);
    })
  }));
  return validateCatalog({ schemaVersion: 1, cards, releases });
}
export function validateCatalog(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.cards) || value.cards.length > 1920 || !Array.isArray(value.releases) || value.releases.length > 64) throw new Error("프로젝트 색인 형식 오류");
  const validUrl = value => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } };
  for (const card of value.cards) {
    if (!/^[a-f0-9]{16}$/.test(card?.id) || !["project", "model", "news"].includes(card.category) || typeof card.title !== "string" || !validUrl(card.url) || !Array.isArray(card.evidence) || card.evidence.some(e => !["official", "creator"].includes(e.kind) || !validUrl(e.url))) throw new Error("프로젝트 색인 카드 오류");
  }
  const seen = new Set();
  for (const entry of value.releases) {
    if (!validReleaseId(entry?.id) || seen.has(entry.id) || !new RegExp(`^editions/${entry.id}-[a-f0-9]{16}\\.json$`).test(entry.path) || !Array.isArray(entry.cardIndexes) || !entry.cardIndexes.length || entry.cardIndexes.length > 30 || new Set(entry.cardIndexes).size !== entry.cardIndexes.length || entry.cardIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= value.cards.length)) throw new Error("프로젝트 색인 연결 오류");
    seen.add(entry.id);
  }
  return value;
}
// The current manifest path is authoritative, including same-slot reissues.
export function catalogCards(catalog, entry) {
  const match = catalog.releases.find(e => e.id === entry.id && e.path === entry.path);
  return match ? match.cardIndexes.map(index => catalog.cards[index]) : null;
}
export function publicEdition(edition) {
  // Observations are collector state; readers need only the chosen card signals.
  const { metricHistory, exposureHistory, repositoryMetrics, candidatePool, ...result } = edition;
  return result;
}
