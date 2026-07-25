export const MODE_POLICIES = Object.freeze({
  learn: Object.freeze({
    id: "learn",
    label: "유형 학습",
    showQuestionMeta: true,
    allowHint: true,
    submission: "confirm",
    feedback: "immediate",
    navigation: false,
    timer: "soft-question",
    deferredCommit: false
  }),
  daily: Object.freeze({
    id: "daily",
    label: "오늘의 훈련",
    showQuestionMeta: false,
    allowHint: false,
    submission: "confirm",
    feedback: "immediate",
    navigation: false,
    timer: "soft-question",
    deferredCommit: false
  }),
  diagnostic: Object.freeze({
    id: "diagnostic",
    label: "진단 테스트",
    showQuestionMeta: false,
    allowHint: false,
    submission: "confirm",
    feedback: "deferred",
    navigation: true,
    timer: "elapsed-question",
    deferredCommit: true
  }),
  exam: Object.freeze({
    id: "exam",
    label: "실전 모의고사",
    showQuestionMeta: false,
    allowHint: false,
    submission: "confirm",
    feedback: "deferred",
    navigation: true,
    timer: "hard-session",
    deferredCommit: true
  }),
  speed: Object.freeze({
    id: "speed",
    label: "속도 훈련",
    showQuestionMeta: false,
    allowHint: false,
    submission: "instant",
    feedback: "none",
    navigation: false,
    timer: "soft-question",
    deferredCommit: false
  }),
  review: Object.freeze({
    id: "review",
    label: "복습 큐",
    showQuestionMeta: false,
    allowHint: false,
    submission: "confirm",
    feedback: "immediate",
    navigation: false,
    timer: "soft-question",
    deferredCommit: false
  }),
  retry: Object.freeze({
    id: "retry",
    label: "즉시 재도전",
    showQuestionMeta: false,
    allowHint: false,
    submission: "confirm",
    feedback: "immediate",
    navigation: false,
    timer: "soft-question",
    deferredCommit: false
  })
});

const LEGACY_MODE_ALIASES = Object.freeze({
  type: "learn",
  mixed25: "diagnostic",
  wrong: "review"
});

export function canonicalMode(mode) {
  return LEGACY_MODE_ALIASES[mode] || mode;
}

export function modePolicy(mode) {
  const canonical = canonicalMode(mode);
  return MODE_POLICIES[canonical] || MODE_POLICIES.daily;
}

export function examDurationMs(questions) {
  const sourceTotal = (questions || []).reduce(
    (sum, question) =>
      sum + Math.max(1, Number(question.timeLimitSec) || 45) * 1000,
    0
  );
  const compressed = Math.round(sourceTotal * 0.85);
  return Math.min(
    25 * 60 * 1000,
    Math.max(10 * 60 * 1000, compressed)
  );
}

export function inferOptionLayout(question) {
  if (["grid", "compact", "list"].includes(question?.optionLayout)) {
    return question.optionLayout;
  }
  const options = question?.options || [];
  if (options.some(option => option.svg)) return "grid";

  const texts = options.map(option => String(option.text ?? ""));
  const longest = texts.reduce(
    (maximum, text) => Math.max(maximum, text.length),
    0
  );
  if (longest > 18 || texts.some(text => /\s/.test(text) && text.length > 10)) {
    return "list";
  }
  return longest <= 6 ? "compact" : "grid";
}
