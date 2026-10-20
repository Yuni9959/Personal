import { validateEdition, validUrl } from "../js/model.js";
import { canonicalUrl, selectDiverse, nextExposureHistory, topicFamily } from "./selection.mjs";

export const EDITORIAL_VERSION = 2;
const ko = value => typeof value === "string" && /[가-힣]/.test(value);
export function validateAnalysis(value, evidence) {
  if (value?.version !== EDITORIAL_VERSION || !ko(value.topic) || value.topic.length > 28 || !ko(value.headline) || !ko(value.summary) || value.summary.length < 70 || value.summary.length > 500 || !Array.isArray(value.slides) || value.slides.length !== 5) throw new Error("한글 심층 요약 형식 오류");
  const ids = new Set(evidence.map(source => source.id));
  for (const slide of value.slides) {
    if (!ko(slide.title) || !ko(slide.body) || slide.body.length < 100 || slide.body.length > 1100 || !Array.isArray(slide.evidenceIds) || !slide.evidenceIds.length || slide.evidenceIds.some(id => !ids.has(id))) throw new Error("요약 근거 또는 본문 부족");
  }
  if (!Number.isFinite(Date.parse(value.reviewedAt))) throw new Error("요약 확인 시각 누락");
  return value;
}
export function applyAnalyses(candidate, analyses, previous = null) {
  const cards = [], pending = [];
  const cache = Object.fromEntries(Object.entries(analyses).map(([url, a]) => [canonicalUrl(url), a]));
  for (const card of candidate.candidatePool || candidate.cards) {
    const analysis = cache[canonicalUrl(card.url)];
    try {
      validateAnalysis(analysis, analysis?.evidence || []);
      if (!analysis.evidence.length || analysis.evidence.some(e => !validUrl(e.url) || typeof e.label !== "string")) throw new Error("근거 링크 오류");
      cards.push({ ...card, signalLabel: card.selection?.badge || card.signalLabel, headline: analysis.headline, topic: analysis.topic, tags: [analysis.topic], summary: analysis.summary, slides: analysis.slides.map((s, i) => ({ ...s, eyebrow: `${String(i + 1).padStart(2, "0")} / ${["무엇인가요", "제작자의 설명", "어디에 쓰나요", "평가와 반응", "도입 전 확인"][i]}` })), evidence: analysis.evidence, reviewedAt: analysis.reviewedAt, summaryMethod: "원문·공개 반응 근거를 사용한 AI 한국어 요약" });
    } catch { pending.push(card.url); }
  }
  // Preserve an already verified Korean edition if newly discovered items have
  // not been researched yet. Never replace it with English placeholder cards.
  for (const card of cards) if (card.selection) card.selection = { ...card.selection, family: topicFamily(card) };
  const selected = candidate.selectionPolicy ? selectDiverse(cards) : cards;
  const pendingTargets = candidate.cards.filter(c => pending.includes(c.url)).length;
  if (selected.length < 3 || new Set(selected.map(c => c.category)).size < 2) {
    if (previous?.schemaVersion === 2) {
      validateEdition(previous);
      return { ...previous, metricHistory: candidate.metricHistory || previous.metricHistory, lastCheckedAt: candidate.generatedAt, pendingCount: pendingTargets, collectionWarning: "새 항목의 한글 심층 요약을 준비 중입니다. 마지막 검증 발행본을 유지합니다.", sources: candidate.sources };
    }
    throw new Error("검증된 한글 카드가 부족하여 직전 발행본을 보존합니다.");
  }
  const { candidatePool, ...publicEdition } = candidate;
  return validateEdition({ ...publicEdition, schemaVersion: 2, cards: selected, pendingCount: pendingTargets, candidateCount: (candidatePool || candidate.cards).length, exposureHistory: nextExposureHistory(selected, previous, new Date(candidate.generatedAt)), lastCheckedAt: candidate.generatedAt, editorial: "최근 관심 증가·공개 시점·개발 활동과 실제 커뮤니티 신호로 후보를 비교합니다. 누적 인기도의 영향은 낮추고 반복 노출·분야·제작자 쏠림을 완화합니다. GitHub 다중 주제·Hugging Face·공식 발표·Hacker News를 6시간마다 확인합니다. 본문을 확보한 한글 심층 카드만 발행하며 각 카드의 ‘선정 이유’에서 관측 근거를 확인할 수 있습니다. 선정 신호는 품질 평가가 아닙니다." });
}
