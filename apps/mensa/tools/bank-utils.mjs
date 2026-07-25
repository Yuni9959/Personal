import { createHash } from "node:crypto";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function optionContent(option) {
  return {
    text: option.text ?? null,
    svg: option.svg ?? null,
    suffix: option.suffix ?? null
  };
}

export function optionSignature(option) {
  return sha256(JSON.stringify(optionContent(option)));
}

export function findCorrectOption(question) {
  if (question.correctOptionId) {
    return question.options.find(option => option.id === question.correctOptionId) || null;
  }

  if (Number.isInteger(question.answerIndex)) {
    return question.options[question.answerIndex] || null;
  }

  return null;
}

export function gradingPayload(question) {
  const correctOption = findCorrectOption(question);
  return {
    typeId: question.typeId,
    prompt: question.prompt,
    stimulusSvg: question.stimulusSvg,
    options: question.options.map(optionContent),
    correctOptionSignature: correctOption ? optionSignature(correctOption) : null,
    timeLimitSec: question.timeLimitSec
  };
}

export function gradingFingerprint(question) {
  return sha256(JSON.stringify(gradingPayload(question)));
}

export function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
