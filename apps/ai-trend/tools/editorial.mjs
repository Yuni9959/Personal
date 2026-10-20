import { validateEdition, validUrl } from "../js/model.js";

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
  for (const card of candidate.cards) {
    const analysis = analyses[card.url];
    try {
      validateAnalysis(analysis, analysis?.evidence || []);
      if (!analysis.evidence.length || analysis.evidence.some(e => !validUrl(e.url) || typeof e.label !== "string")) throw new Error("근거 링크 오류");
      cards.push({ ...card, headline: analysis.headline, topic: analysis.topic, tags: [analysis.topic], summary: analysis.summary, slides: analysis.slides.map((s, i) => ({ ...s, eyebrow: `${String(i + 1).padStart(2, "0")} / ${["무엇인가요", "제작자의 설명", "어디에 쓰나요", "평가와 반응", "도입 전 확인"][i]}` })), evidence: analysis.evidence, reviewedAt: analysis.reviewedAt, summaryMethod: "원문·공개 반응 근거를 사용한 AI 한국어 요약" });
    } catch { pending.push(card.url); }
  }
  // Preserve an already verified Korean edition if newly discovered items have
  // not been researched yet. Never replace it with English placeholder cards.
  if (cards.length < 3 || new Set(cards.map(c => c.category)).size < 2) {
    if (previous?.schemaVersion === 2) {
      validateEdition(previous);
      return { ...previous, lastCheckedAt: candidate.generatedAt, pendingCount: pending.length, collectionWarning: "새 항목의 한글 심층 요약을 준비 중입니다. 마지막 검증 발행본을 유지합니다.", sources: candidate.sources };
    }
    throw new Error("검증된 한글 카드가 부족하여 직전 발행본을 보존합니다.");
  }
  return validateEdition({ ...candidate, schemaVersion: 2, cards, pendingCount: pending.length, lastCheckedAt: candidate.generatedAt, editorial: "GitHub Trending·신규 저장소, Hugging Face 모델, 공식 AI 뉴스를 6시간마다 수집합니다. 원문 설명·제작자의 주장·활용 사례·실제 공개 반응·도입 조건을 한국어 5장으로 정리합니다. 반응은 표본이며 별·다운로드 수는 품질 평가가 아닙니다. 새 분야명은 내용에 따라 추가됩니다." });
}
