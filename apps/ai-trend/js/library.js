// Compare project identity conservatively: a shared topic or citation is not identity.
export function normalizedUrl(value, category) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    url.hostname = url.hostname.replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|ref_src)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (category === "project" && url.hostname === "github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) { url.pathname = `/${parts[0]}/${parts[1].replace(/\.git$/i, "")}`.toLowerCase(); url.search = ""; }
    }
    return url.href;
  } catch { return null; }
}
const name = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, "").trim();
export function identityCard(card) {
  return { id: card.id, category: card.category, title: card.title, name: card.name || card.title,
    url: card.url, source: card.source,
    // Only creator/official evidence can bridge a repository and its product site.
    evidence: (card.evidence || []).filter(e => ["official", "creator"].includes(e.kind)).map(e => ({ url: e.url, kind: e.kind })) };
}
export function sameProject(a, b) {
  if (a.category !== b.category) return false;
  const left = normalizedUrl(a.url, a.category), right = normalizedUrl(b.url, b.category);
  if (left && left === right) return true;
  if (a.category !== "project") return false;
  const repo = value => { try { const u = new URL(value); return u.hostname === "github.com" && u.pathname.split("/").filter(Boolean).length === 2 ? name(u.pathname.slice(1)) : null; } catch { return null; } };
  const leftRepo = repo(left), rightRepo = repo(right);
  if (leftRepo && rightRepo) return false; // forks / namesakes from different owners
  const namesA = [name(a.title), name(a.name)].filter(Boolean), namesB = [name(b.title), name(b.name)].filter(Boolean);
  if (leftRepo && namesB.includes(leftRepo) || rightRepo && namesA.includes(rightRepo)) return true;
  const short = value => value.split("/").at(-1);
  const matchingName = namesA.some(x => namesB.some(y => x === y || short(x) === short(y)));
  if (!matchingName) return false;
  const official = card => (card.evidence || []).filter(e => ["official", "creator"].includes(e.kind)).map(e => normalizedUrl(e.url, "project")).filter(Boolean);
  if (official(a).includes(right) || official(b).includes(left)) return true;
  // A stable name on the same official website also survives a moved product path.
  try {
    const host = new URL(left).hostname;
    return !leftRepo && !rightRepo && !["github.com", "gitlab.com", "huggingface.co", "npmjs.com", "pypi.org"].includes(host) && host === new URL(right).hostname && namesA.some(x => namesB.includes(x));
  } catch { return false; }
}
export function occurrenceFor(card, editionId, catalog) {
  const ids = new Set((catalog || []).filter(e => e.id <= editionId && e.cards?.some(c => sameProject(card, c))).map(e => e.id));
  ids.add(editionId);
  return { count: ids.size, repeats: ids.size - 1, first: [...ids].sort()[0] };
}
export const editionKey = edition => edition.publication?.id || edition.date;
export const editionLabel = edition => `${edition.date}${edition.publication ? ` · ${edition.publication.id.endsWith("07") ? "아침" : "저녁"}` : ""}`;
