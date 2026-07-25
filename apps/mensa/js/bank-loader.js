const BANK_URL = new URL("../data/question-bank.json", import.meta.url);

function assertRuntimeBank(bank) {
  if (bank?.schemaVersion !== 2) {
    throw new Error(`지원하지 않는 문제은행 스키마입니다: ${bank?.schemaVersion}`);
  }
  if (typeof bank.bankVersion !== "string" || !bank.bankVersion) {
    throw new Error("문제은행 버전이 없습니다.");
  }
  if (!Array.isArray(bank.types) || !Array.isArray(bank.questions)) {
    throw new Error("문제은행 배열을 읽을 수 없습니다.");
  }

  for (const question of bank.questions) {
    if (!Array.isArray(question.options) ||
        !question.options.some(option => option.id === question.correctOptionId)) {
      throw new Error(`정답 옵션을 찾을 수 없습니다: ${question.id}`);
    }
  }
}

export async function loadQuestionBank(fetchImpl = fetch) {
  const response = await fetchImpl(BANK_URL, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`문제은행 요청 실패: HTTP ${response.status}`);
  }

  const bank = await response.json();
  assertRuntimeBank(bank);
  return bank;
}

export { BANK_URL };
