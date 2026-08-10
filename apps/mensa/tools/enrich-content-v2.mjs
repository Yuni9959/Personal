import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradingFingerprint } from "./bank-utils.mjs";

export const CONTENT_QUALITY_VERSION = 2;
export const TARGET_BANK_VERSION = "2026.08.10-content.4";

const here = path.dirname(fileURLToPath(import.meta.url));
const mensaRoot = path.resolve(here, "..");
const dataPath = path.join(mensaRoot, "data", "question-bank.json");

export const COGNITIVE_DOMAINS = Object.freeze([
  {
    id: "figure-rules",
    label: "도형 규칙",
    description: "합성·집합 연산·중첩·행렬의 시각 규칙을 찾습니다."
  },
  {
    id: "sequence-attributes",
    label: "순서·다중속성",
    description: "서로 다른 순서와 속성을 분리해 동시에 추적합니다."
  },
  {
    id: "spatial-reasoning",
    label: "공간 추론",
    description: "이동·회전·가림·입체 접기를 머릿속에서 조작합니다."
  },
  {
    id: "quantitative-equivalence",
    label: "수리·등가",
    description: "산술 관계·비율·등가 치환을 식으로 검증합니다."
  },
  {
    id: "counting-attention",
    label: "개수·주의",
    description: "포함 도형을 체계적으로 세고 방해 자극을 억제합니다."
  }
]);

export const ERROR_TAXONOMY = Object.freeze({
  "attribute-incomplete": {
    label: "속성 일부만 확인",
    diagnosis: "여러 조건 가운데 한 조건만 맞추고 나머지를 놓친 선택입니다.",
    action: "각 속성을 따로 적은 뒤 마지막에 한 보기에서 모두 만족하는지 확인하세요."
  },
  "direction-reversal": {
    label: "방향 반전",
    diagnosis: "이동이나 회전의 방향을 반대로 적용했을 가능성이 큽니다.",
    action: "시계·반시계 방향을 화살표로 표시하고 한 단계씩 이동하세요."
  },
  "movement-distance": {
    label: "이동 거리 오류",
    diagnosis: "방향은 추적했지만 이동 칸 수가 어긋난 선택입니다.",
    action: "출발점을 고정한 뒤 한 칸씩 세어 최종 위치를 대조하세요."
  },
  "element-omission": {
    label: "요소 누락",
    diagnosis: "합성하거나 세어야 할 선·면·도형 일부를 빠뜨린 선택입니다.",
    action: "원본 요소에 표시하며 하나씩 결과에 대응시키세요."
  },
  "element-excess": {
    label: "불필요 요소 포함",
    diagnosis: "제거되거나 가려져야 할 요소를 결과에 남긴 선택입니다.",
    action: "각 요소가 남는 조건과 사라지는 조건을 먼저 구분하세요."
  },
  "common-element-retained": {
    label: "공통요소 미제거",
    diagnosis: "양쪽에 공통인 요소를 제거해야 하는데 그대로 남긴 선택입니다.",
    action: "공통 요소에 먼저 표시한 뒤 남는 요소만 다시 그려 보세요."
  },
  "operation-confusion": {
    label: "연산 규칙 혼동",
    diagnosis: "합집합·차집합·대칭차 가운데 다른 연산을 적용한 선택입니다.",
    action: "예시마다 공통 요소가 남는지 사라지는지를 표로 정리하세요."
  },
  "shape-mismatch": {
    label: "모양 불일치",
    diagnosis: "개수나 표현은 비슷하지만 목표 모양 자체가 다른 선택입니다.",
    action: "꼭짓점·변·내부 연결을 차례로 비교하세요."
  },
  "fill-style-mismatch": {
    label: "표현 방식 불일치",
    diagnosis: "도형은 맞지만 채움·실선·점선 표현이 다른 선택입니다.",
    action: "모양과 표현 방식을 서로 다른 두 규칙으로 추적하세요."
  },
  "color-only": {
    label: "색상만 일치",
    diagnosis: "색 순서는 맞지만 모양·크기·위치 조건이 다른 선택입니다.",
    action: "색을 결정한 뒤 두 번째 속성을 별도로 검산하세요."
  },
  "shape-only": {
    label: "모양만 일치",
    diagnosis: "모양은 맞지만 색·채움·순서 조건이 다른 선택입니다.",
    action: "모양을 고른 뒤 표현 속성까지 같은 보기인지 확인하세요."
  },
  "sequence-offset": {
    label: "수열 위치 어긋남",
    diagnosis: "규칙의 주기는 찾았지만 시작점이나 다음 순서를 한 칸 잘못 잡은 선택입니다.",
    action: "각 항에 순번을 붙여 다음 항이 어느 주기 위치인지 확인하세요."
  },
  "count-cycle-mismatch": {
    label: "개수 주기 오류",
    diagnosis: "개수의 반복 주기를 다른 속성의 주기와 섞은 선택입니다.",
    action: "개수만 따로 나열해 다음 값을 먼저 확정하세요."
  },
  "position-cycle-mismatch": {
    label: "위치 주기 오류",
    diagnosis: "도형 수는 맞지만 점이나 요소의 위치 주기가 어긋난 선택입니다.",
    action: "위치 이름을 순서대로 적어 독립된 주기로 추적하세요."
  },
  "occlusion-misread": {
    label: "가림 해석 오류",
    diagnosis: "가려진 요소를 사라진 것으로 보거나 가린 뒤에도 보인다고 판단한 선택입니다.",
    action: "앞·뒤 순서를 정한 뒤 보이는 부분만 남기세요."
  },
  "layer-order": {
    label: "중첩 순서 오류",
    diagnosis: "요소는 모두 포함했지만 어느 도형이 앞에 놓이는지 잘못 적용한 선택입니다.",
    action: "배경부터 앞쪽 요소 순서로 한 층씩 겹쳐 보세요."
  },
  "spatial-alignment": {
    label: "중심 정렬 오류",
    diagnosis: "겹칠 요소의 크기나 중심 위치를 다르게 맞춘 선택입니다.",
    action: "공통 중심과 기준선을 먼저 맞춘 뒤 선을 합치세요."
  },
  "row-only-check": {
    label: "행·열 교차검증 누락",
    diagnosis: "한 방향 규칙에는 맞지만 다른 방향 검산을 통과하지 못한 선택입니다.",
    action: "가로 규칙으로 후보를 만든 뒤 세로 규칙으로 반드시 다시 확인하세요."
  },
  "rule-overfit": {
    label: "한 예시에만 맞춘 규칙",
    diagnosis: "첫 예시에는 맞지만 다른 예시에는 성립하지 않는 관계를 사용한 선택입니다.",
    action: "같은 식이 두 개 이상의 예시에 동시에 성립하는지 대입하세요."
  },
  calculation: {
    label: "계산 오류",
    diagnosis: "관계식은 찾았지만 산술 계산이나 부호 처리에서 벗어난 선택입니다.",
    action: "식을 한 줄로 적고 역산으로 결과를 확인하세요."
  },
  "equivalence-substitution": {
    label: "등가 치환 오류",
    diagnosis: "같은 무게의 도형 묶음을 치환하는 과정이 어긋난 선택입니다.",
    action: "양변의 공통 항을 지운 뒤 남은 등가관계만 치환하세요."
  },
  "ratio-time-confusion": {
    label: "비율 시점 혼동",
    diagnosis: "현재의 나이 비율을 미래에도 그대로 적용한 선택입니다.",
    action: "두 사람에게 같은 시간이 더해지고 나이 차는 유지된다는 식을 세우세요."
  },
  "count-omission": {
    label: "개수 누락",
    diagnosis: "작은 도형만 세거나 큰 결합 도형 일부를 빠뜨린 선택입니다.",
    action: "크기나 시작점별 소계를 만든 뒤 합산하세요."
  },
  "count-duplication": {
    label: "중복 계산",
    diagnosis: "같은 도형을 두 경로에서 다시 세어 실제보다 크게 계산한 선택입니다.",
    action: "각 도형을 시작점과 끝점의 한 쌍으로 표시해 한 번만 세세요."
  },
  "rotation-misclassification": {
    label: "회전 도형 오분류",
    diagnosis: "회전된 목표 도형을 다른 모양으로 보거나 반대로 포함한 선택입니다.",
    action: "방향이 아니라 변의 수와 연결 구조로 목표 도형을 판별하세요."
  },
  "semantic-interference": {
    label: "의미 간섭",
    diagnosis: "글자의 실제 색보다 글자가 뜻하는 색에 반응한 선택입니다.",
    action: "단어를 읽지 말고 글자 표면의 색만 위에서부터 말해 보세요."
  },
  "option-sequence-mismatch": {
    label: "보기 순서 대조 오류",
    diagnosis: "구한 요소는 비슷하지만 보기의 배열 순서가 다른 선택입니다.",
    action: "구한 순서를 처음부터 끝까지 보기와 한 칸씩 대조하세요."
  },
  "fold-overlap-misread": {
    label: "전개도 면 겹침 오판",
    diagnosis: "접었을 때 만나는 면의 경로를 끝까지 추적하지 못한 선택입니다.",
    action: "기준 면을 하나 정하고 네 이웃 면과 마지막 면의 위치를 차례로 접어 보세요."
  },
  "condition-misread": {
    label: "조건 오독",
    diagnosis: "문제가 요구한 대상이나 포함 조건을 다르게 해석한 선택입니다.",
    action: "무엇을 포함하고 제외하는지 문제 문장을 짧게 다시 적으세요."
  }
});

const TYPE_CONFIG = Object.freeze({
  T01: config("quantitative-equivalence",
    "검은 공과 흰 공의 무게를 환산해 위치별로 합친 뒤 좌우 총무게로 기울기를 정합니다.",
    "공의 수와 종류를 먼저 합산하세요.",
    "마지막에는 공의 구성뿐 아니라 어느 쪽이 내려가는지도 대조하세요.",
    "공의 개수와 지렛대 기울기를 모두 만족하는지 검산합니다.",
    [3, 3, 3, 3, 3], ["attribute-incomplete", "direction-reversal", "element-omission"]),
  T02: config("figure-rules",
    "앞의 두 도형을 같은 위치에 합쳐 모든 구성요소를 남깁니다.",
    "두 입력 도형의 선과 면을 따로 목록으로 만들어 보세요.",
    "두 목록의 합집합과 같은 보기를 찾으세요.",
    "원본의 모든 요소가 한 번 이상 결과에 들어갔는지 검산합니다.",
    [2, 3, 2, 3, 3], ["element-omission", "element-excess", "shape-mismatch"]),
  T03: config("sequence-attributes",
    "꼭짓점 수의 변화와 내부 연결 방식을 각각 수열로 추적합니다.",
    "바깥 꼭짓점 수만 먼저 나열하세요.",
    "내부 선이 건너뛰는 간격도 별도 수열로 확인하세요.",
    "꼭짓점 수와 내부 연결 규칙이 동시에 이어지는지 검산합니다.",
    [3, 3, 3, 3, 3], ["sequence-offset", "shape-mismatch", "condition-misread"]),
  T04: config("figure-rules",
    "XOR에서는 두 입력에 공통인 선분을 지우고 한쪽에만 있는 선분을 남깁니다.",
    "두 도형에 공통으로 있는 선부터 표시하세요.",
    "공통선을 지운 뒤 한쪽에만 남은 선을 합치세요.",
    "합집합처럼 공통 선분을 남기지 않았는지 검산합니다.",
    [3, 3, 2, 4, 4], ["common-element-retained", "element-omission", "operation-confusion"]),
  T05: config("sequence-attributes",
    "가로선과 세로선의 개수 주기를 서로 독립적으로 추적합니다.",
    "가로선 개수만 순서대로 적으세요.",
    "세로선 개수 수열을 따로 만든 뒤 두 값을 결합하세요.",
    "두 색 또는 두 방향의 개수를 각각 다시 셉니다.",
    [3, 4, 3, 3, 4], ["count-cycle-mismatch", "attribute-incomplete", "sequence-offset"]),
  T06: config("spatial-reasoning",
    "검은 원의 둘레 이동과 짧은 선분의 회전을 서로 다른 규칙으로 적용합니다.",
    "검은 원의 이동 방향과 칸 수부터 표시하세요.",
    "선분은 원과 분리해 회전 방향을 추적하세요.",
    "원 위치와 선분 방향이 모두 맞는지 검산합니다.",
    [4, 4, 4, 3, 4], ["direction-reversal", "movement-distance", "attribute-incomplete"]),
  T07: config("spatial-reasoning",
    "두 원은 서로 다른 방향과 속도로 이동하며 겹쳐도 각각의 궤적을 유지합니다.",
    "검은 원의 위치만 한 단계씩 표시하세요.",
    "흰 원의 반대 방향 이동을 따로 추적하고 마지막에 겹치세요.",
    "겹친 원을 사라진 것으로 처리하지 않았는지 검산합니다.",
    [4, 4, 5, 3, 4], ["direction-reversal", "occlusion-misread", "movement-distance"]),
  T08: config("sequence-attributes",
    "도형 종류와 표현 방식이 각 행·열에서 한 번씩 나타나도록 배열합니다.",
    "빈칸에 필요한 도형 종류를 먼저 찾으세요.",
    "실선·점선·채움 중 빠진 표현 방식을 따로 찾으세요.",
    "도형과 표현 방식 두 조건을 동시에 만족하는지 검산합니다.",
    [3, 4, 3, 3, 4], ["fill-style-mismatch", "shape-only", "attribute-incomplete"]),
  T09: config("figure-rules",
    "같은 중심에 도형을 겹치되 앞의 검은 면이 뒤쪽 선을 가립니다.",
    "두 도형의 공통 중심을 먼저 맞추세요.",
    "검은 면 뒤에 들어가는 선은 보이지 않는다고 처리하세요.",
    "보존할 요소와 가려질 요소를 각각 검산합니다.",
    [3, 3, 4, 4, 4], ["occlusion-misread", "element-omission", "layer-order"]),
  T10: config("figure-rules",
    "예시에서 각 기호가 합집합·차집합·XOR 중 무엇인지 먼저 귀납합니다.",
    "각 예시의 공통 요소가 남는지부터 관찰하세요.",
    "기호 뜻을 확정한 뒤 마지막 도형의 요소별로 적용하세요.",
    "다른 연산 기호의 규칙을 섞지 않았는지 검산합니다.",
    [4, 4, 4, 3, 5], ["operation-confusion", "common-element-retained", "element-omission"]),
  T11: config("sequence-attributes",
    "색상별 등장 빈도와 크기 조합을 분리해 빠진 조합을 찾습니다.",
    "각 색이 몇 번 나오는지 세어 보세요.",
    "같은 색 안에서 큰 원과 작은 원의 빈도를 비교하세요.",
    "색과 크기가 모두 빠진 조합인지 검산합니다.",
    [3, 4, 3, 3, 4], ["color-only", "shape-only", "count-omission"]),
  T12: config("spatial-reasoning",
    "입체선과 평면무늬를 같은 중심·크기로 정렬해 모든 보이는 선을 합칩니다.",
    "두 그림의 중심과 바깥 경계를 맞추세요.",
    "각 선분을 하나씩 결과 그림에 옮겨 보세요.",
    "전체 인상보다 누락된 선이 없는지 검산합니다.",
    [3, 3, 4, 4, 4], ["element-omission", "spatial-alignment", "layer-order"]),
  T13: config("sequence-attributes",
    "색상 순환과 도형 순환을 별도 수열로 진행한 뒤 같은 항에서 결합합니다.",
    "색만 보고 다음 색을 정하세요.",
    "도형만 보고 다음 모양을 정한 뒤 두 결과를 합치세요.",
    "색과 도형 중 한 규칙만 맞는 보기를 제외합니다.",
    [3, 4, 4, 3, 4], ["color-only", "shape-only", "sequence-offset"]),
  T14: config("sequence-attributes",
    "도형 개수와 점 위치가 서로 다른 길이의 주기로 반복됩니다.",
    "도형 개수 수열의 주기를 먼저 찾으세요.",
    "점 위치를 이름으로 바꿔 별도 주기를 적으세요.",
    "서로 다른 두 주기의 다음 항을 같은 칸에 결합했는지 검산합니다.",
    [4, 4, 5, 3, 4], ["count-cycle-mismatch", "position-cycle-mismatch", "attribute-incomplete"]),
  T15: config("figure-rules",
    "각 행과 열에서 앞의 두 칸을 겹친 결과가 세 번째 칸이 됩니다.",
    "빈칸이 속한 행의 두 입력을 먼저 겹치세요.",
    "얻은 후보를 같은 열의 규칙으로 다시 확인하세요.",
    "한 행만 맞는 후보가 아니라 행과 열을 모두 통과하는지 검산합니다.",
    [4, 4, 4, 4, 5], ["row-only-check", "element-omission", "element-excess"]),
  T16: config("quantitative-equivalence",
    "모든 가로줄과 세로줄의 합이 같은 목표합이 되도록 빈칸을 계산합니다.",
    "완성된 줄 하나로 목표합을 구하세요.",
    "빈칸이 있는 줄에서 알려진 수를 목표합에서 빼세요.",
    "다른 방향의 줄에도 대입해 같은 합이 되는지 검산합니다.",
    [3, 3, 3, 2, 4], ["calculation", "row-only-check", "condition-misread"]),
  T17: config("quantitative-equivalence",
    "앞의 두 행에 공통으로 성립하는 산술 관계를 찾아 마지막 행에 적용합니다.",
    "첫 행에 맞는 간단한 식을 몇 개 시험하세요.",
    "둘째 행에도 같은 식을 대입해 하나만 남기세요.",
    "마지막 값은 역산해 원래 관계가 성립하는지 검산합니다.",
    [4, 3, 4, 2, 4], ["calculation", "rule-overfit", "condition-misread"]),
  T18: config("quantitative-equivalence",
    "균형식 양변의 공통 도형을 상쇄하고 남은 도형을 등가 묶음으로 치환합니다.",
    "양쪽에 똑같이 있는 도형부터 지우세요.",
    "남은 등가관계를 한 종류의 도형으로 치환하세요.",
    "선택한 묶음을 원래 저울식에 넣어 균형이 유지되는지 검산합니다.",
    [4, 4, 4, 3, 4], ["equivalence-substitution", "common-element-retained", "calculation"]),
  T20: config("quantitative-equivalence",
    "두 사람에게 같은 시간이 더해지므로 나이 차는 유지된다는 방정식을 세웁니다.",
    "현재 두 사람의 나이 차를 먼저 구하세요.",
    "같은 미지수를 두 나이에 더해 목표 비율의 식을 세우세요.",
    "구한 미래 나이를 원래 비율에 대입해 검산합니다.",
    [4, 3, 4, 1, 4], ["ratio-time-confusion", "calculation", "condition-misread"]),
  T21: config("counting-attention",
    "가로선 두 개와 세로선 두 개를 고르는 모든 조합이 직사각형 하나를 만듭니다.",
    "작은 칸뿐 아니라 여러 칸을 합친 직사각형도 포함하세요.",
    "가로선 쌍과 세로선 쌍의 수를 각각 구해 곱하세요.",
    "정사각형을 제외하거나 같은 직사각형을 중복하지 않았는지 검산합니다.",
    [3, 3, 3, 4, 4], ["count-omission", "count-duplication", "condition-misread"]),
  T22: config("counting-attention",
    "방향과 크기가 달라도 변의 수가 같은 목표 다각형을 행별로 셉니다.",
    "목표 변의 수를 먼저 손가락으로 따라가 보세요.",
    "행별 소계를 적고 다음 행으로 넘어가세요.",
    "회전된 도형을 빠뜨리거나 한 도형을 두 번 세지 않았는지 검산합니다.",
    [3, 3, 4, 5, 4], ["count-omission", "count-duplication", "rotation-misclassification"]),
  T23: config("counting-attention",
    "단어의 뜻을 억제하고 글자 표면에 실제로 칠해진 색만 순서대로 읽습니다.",
    "단어를 소리 내어 읽지 말고 표면 색만 말하세요.",
    "위에서부터 얻은 색 순서를 보기와 끝까지 대조하세요.",
    "뜻의 색이 섞이지 않았고 보기 순서가 같은지 검산합니다.",
    [3, 3, 4, 3, 5], ["semantic-interference", "option-sequence-mismatch"], "supplemental"),
  T24: config("spatial-reasoning",
    "기준 면을 중심으로 이웃 면을 접어 같은 공간을 차지하는 면이 생기는지 확인합니다.",
    "한 칸을 바닥으로 정하고 인접한 네 면을 세워 보세요.",
    "마지막 면이 어느 방향에서 닫히는지 추적하세요.",
    "접었을 때 두 면이 겹치거나 한 면이 비지 않는지 검산합니다.",
    [5, 3, 5, 5, 5], ["fold-overlap-misread", "direction-reversal", "condition-misread"]),
  T25: config("counting-attention",
    "꼭짓점과 밑변의 두 점을 고르는 모든 조합이 하나의 삼각형을 만듭니다.",
    "가장 작은 삼각형부터 크기별로 세어 보세요.",
    "밑변 점의 모든 두 점 조합을 빠짐없이 포함하세요.",
    "연속하지 않은 밑변 점으로 만든 큰 삼각형과 중복을 검산합니다.",
    [3, 3, 4, 4, 4], ["count-omission", "count-duplication", "condition-misread"])
});

export const SOURCE_ERROR_TAG_MAP = Object.freeze({
  "age-equation-error": "ratio-time-confusion",
  "attribute-pair-error": "attribute-incomplete",
  "back-omitted": "element-omission",
  "color-size-pair-error": "attribute-incomplete",
  "count-position-cycle-error": "attribute-incomplete",
  "counter-rotation-error": "direction-reversal",
  "cube-edge-union-error": "element-omission",
  "cube-net-fold-error": "fold-overlap-misread",
  "double-sequence-error": "attribute-incomplete",
  "equivalence-substitution-error": "equivalence-substitution",
  "fan-triangle-count-error": "count-omission",
  "formula-error": "calculation",
  "front-not-opaque": "occlusion-misread",
  "independent-cycle-error": "attribute-incomplete",
  "layer-order-reversed": "layer-order",
  "magic-sum-error": "calculation",
  "matrix-combination-error": "row-only-check",
  "object-added": "element-excess",
  "object-omitted": "element-omission",
  "offset-mirrored": "spatial-alignment",
  "offset-vertical-error": "spatial-alignment",
  "one-cycle-missed": "count-cycle-mismatch",
  "operator-misidentified": "operation-confusion",
  "polygon-count-error": "rotation-misclassification",
  "rectangle-count-error": "count-omission",
  "sequence-attribute-error": "attribute-incomplete",
  "shape-role-swapped": "layer-order",
  "sides-swapped": "direction-reversal",
  "stroop-sequence-error": "semantic-interference",
  "tilt-ignored": "attribute-incomplete",
  "union-error": "operation-confusion",
  "xor-error": "operation-confusion"
});

function config(
  domainId,
  rule,
  hint1,
  hint2,
  verification,
  difficultyBase,
  errorTags,
  scoreGroup = "core"
) {
  return {
    domainId,
    scoreGroup,
    rule,
    hint1,
    hint2,
    verification,
    difficultyBase,
    errorTags
  };
}

function clampDifficulty(value) {
  return Math.min(5, Math.max(1, Math.round(value)));
}

function derivedDomainId(type) {
  const family = String(type.familyId || "");
  if (/(rotation|motion|toroidal|orientation|path|diagonal)/i.test(family)) {
    return "spatial-reasoning";
  }
  if (/(latin|sequence|progression|orthogonal|nested)/i.test(family)) {
    return "sequence-attributes";
  }
  return "figure-rules";
}

function derivedErrorTags(type) {
  const family = String(type.familyId || "");
  if (/(set-operation|exact-cover|mixed-operator|signed|ternary)/i.test(
    family
  )) {
    return [
      "operation-confusion",
      "element-omission",
      "element-excess"
    ];
  }
  if (/(rotation|motion|toroidal|orientation|path|diagonal)/i.test(family)) {
    return [
      "direction-reversal",
      "movement-distance",
      "attribute-incomplete"
    ];
  }
  return [
    "attribute-incomplete",
    "row-only-check",
    "sequence-offset"
  ];
}

function derivedTypeConfig(type, questions) {
  const representative = questions.find(
    question => question.typeId === type.id
  );
  const steps = Array.isArray(representative?.explanationSteps)
    ? representative.explanationSteps
    : [];
  const authoring =
    representative?.authoringDifficultyProfile ||
    representative?.difficultyProfile ||
    {};
  const rule =
    representative?.ruleSignature ||
    (typeof representative?.explanation === "string"
      ? representative.explanation
      : representative?.explanation?.rule) ||
    `${type.title} 규칙을 행·열과 대각선에서 일관되게 적용합니다.`;
  const hint1 = steps[0]?.text ||
    "한 방향의 변화만 먼저 분리해 반복되는 속성을 찾으세요.";
  const hint2 = steps[1]?.text ||
    "찾은 규칙을 다른 행·열에도 대입해 같은 결과가 나오는지 확인하세요.";
  const verification = steps.at(-1)?.text ||
    "후보가 모든 행·열의 속성을 동시에 만족하는지 검산합니다.";
  const difficultyBase = [
    (Number(authoring.ruleCount) + Number(authoring.inferenceDepth)) / 2,
    Number(authoring.independentAttributes),
    Number(authoring.workingMemory),
    Number(authoring.visualLoad),
    Number(authoring.distractorSimilarity)
  ].map(value => Number.isFinite(value) ? clampDifficulty(value) : 3);

  return config(
    derivedDomainId(type),
    rule,
    hint1,
    hint2,
    verification,
    difficultyBase,
    derivedErrorTags(type)
  );
}

function typeConfigsForSource(source) {
  const configs = new Map(Object.entries(TYPE_CONFIG));
  for (const type of source.types) {
    if (!configs.has(type.id)) {
      configs.set(
        type.id,
        derivedTypeConfig(type, source.questions)
      );
    }
  }
  return configs;
}

function authorDifficultyToRuntime(value) {
  const level = Number(value);
  if (level <= 5) return clampDifficulty(level);
  return level === 6 ? 3 : level === 7 ? 4 : 5;
}

function validRuntimeProfile(profile) {
  return profile &&
    Number.isInteger(profile.overall) &&
    profile.overall >= 1 &&
    profile.overall <= 5;
}

function richDifficultyProfile(question, typeConfig, sourceDifficulty) {
  const authoring = question.authoringDifficultyProfile;
  const ruleSteps = clampDifficulty(
    (Number(authoring.ruleCount) + Number(authoring.inferenceDepth)) / 2
  );
  const attributeLoad = clampDifficulty(authoring.independentAttributes);
  const workingMemory = clampDifficulty(authoring.workingMemory);
  const visualComplexity = clampDifficulty(authoring.visualLoad);
  const distractorSimilarity = clampDifficulty(
    authoring.distractorSimilarity
  );
  const transformationComplexity = clampDifficulty(
    authoring.transformationComplexity
  );
  const timePressure = clampDifficulty(
    2 +
    (Number(sourceDifficulty) - 3) * 0.45 +
    ((question.timeLimitSec || 45) <= 40 ? 0.5 : 0)
  );
  const metricOverall = clampDifficulty(
    ruleSteps * 0.2 +
    attributeLoad * 0.15 +
    workingMemory * 0.15 +
    visualComplexity * 0.14 +
    distractorSimilarity * 0.14 +
    transformationComplexity * 0.17 +
    timePressure * 0.05
  );

  return {
    sourceDifficulty,
    sourceScale: "3-8",
    overall: Number(sourceDifficulty) === 3
      ? clampDifficulty(metricOverall - 1)
      : Math.max(
          authorDifficultyToRuntime(sourceDifficulty),
          metricOverall
        ),
    ruleSteps,
    attributeLoad,
    workingMemory,
    visualComplexity,
    distractorSimilarity,
    transformationComplexity,
    timePressure,
    rationale: typeConfig.rule
  };
}

function difficultyProfile(question, typeConfig, sourceDifficulty) {
  if (question.contentQualityVersion === CONTENT_QUALITY_VERSION &&
      validRuntimeProfile(question.difficultyProfile)) {
    return question.difficultyProfile;
  }
  if (question.provenance?.sourceId === "foundation-v1" &&
      validRuntimeProfile(question.difficultyProfile)) {
    return {
      ...question.difficultyProfile,
      rationale: typeConfig.rule
    };
  }
  if (question.authoringDifficultyProfile) {
    return richDifficultyProfile(question, typeConfig, sourceDifficulty);
  }

  const runtimeSource = authorDifficultyToRuntime(sourceDifficulty);
  const modifier = (runtimeSource - 3) * 0.55;
  const [
    ruleSteps,
    attributeLoad,
    workingMemory,
    visualComplexity,
    distractorSimilarity
  ] = typeConfig.difficultyBase.map(value =>
    clampDifficulty(value + modifier)
  );
  const timePressure = clampDifficulty(
    3 + modifier + ((question.timeLimitSec || 45) <= 40 ? 0.7 : 0)
  );
  const metricOverall = clampDifficulty(
    ruleSteps * 0.22 +
    attributeLoad * 0.18 +
    workingMemory * 0.2 +
    visualComplexity * 0.16 +
    distractorSimilarity * 0.16 +
    timePressure * 0.08
  );

  return {
    sourceDifficulty,
    sourceScale: Number(sourceDifficulty) > 5 ? "6-8" : "1-5",
    overall: Math.max(runtimeSource, metricOverall),
    ruleSteps,
    attributeLoad,
    workingMemory,
    visualComplexity,
    distractorSimilarity,
    timePressure,
    rationale: typeConfig.rule
  };
}

function numericOptionValue(option) {
  if (option?.text == null) return null;
  const normalized = String(option.text).replaceAll(",", "").trim();
  return /^-?\d+(?:\.\d+)?$/.test(normalized)
    ? Number(normalized)
    : null;
}

function primitiveCount(svg) {
  if (typeof svg !== "string") return 0;
  return [...svg.matchAll(
    /<(?:line|circle|ellipse|polygon|polyline|path|text)\b/g
  )].length;
}

function styleSignature(svg) {
  if (typeof svg !== "string") return "";
  const fills = [...svg.matchAll(/\sfill="([^"]+)"/g)]
    .map(match => match[1])
    .filter(fill => fill !== "#ffffff")
    .sort();
  const dashed = (svg.match(/stroke-dasharray/g) || []).length;
  return JSON.stringify({ fills, dashed });
}

function classifyWrongOption(
  question,
  option,
  correctOption,
  optionIndex,
  typeConfig
) {
  const optionNumber = numericOptionValue(option);
  const correctNumber = numericOptionValue(correctOption);
  const sourceTag = option.sourceErrorTag || option.errorTag;

  if (sourceTag && ERROR_TAXONOMY[sourceTag]) return sourceTag;
  if (sourceTag && ["T21", "T22", "T25"].includes(question.typeId) &&
      optionNumber != null && correctNumber != null) {
    return optionNumber < correctNumber
      ? "count-omission"
      : "count-duplication";
  }
  if (sourceTag && SOURCE_ERROR_TAG_MAP[sourceTag]) {
    return SOURCE_ERROR_TAG_MAP[sourceTag];
  }

  if (question.typeId === "T23") {
    return optionIndex % 2
      ? "option-sequence-mismatch"
      : "semantic-interference";
  }
  if (question.typeId === "T24") return "fold-overlap-misread";

  if (optionNumber != null && correctNumber != null) {
    if (["T21", "T22", "T25"].includes(question.typeId)) {
      return optionNumber < correctNumber
        ? "count-omission"
        : "count-duplication";
    }
    if (question.typeId === "T20") {
      return optionIndex % 2 ? "ratio-time-confusion" : "calculation";
    }
    return optionIndex % 3 === 0 ? "row-only-check" : "calculation";
  }

  if (option.svg && correctOption.svg) {
    const countDifference =
      primitiveCount(option.svg) - primitiveCount(correctOption.svg);
    if (countDifference < 0 &&
        typeConfig.errorTags.includes("element-omission")) {
      return "element-omission";
    }
    if (countDifference > 0 &&
        typeConfig.errorTags.includes("element-excess")) {
      return "element-excess";
    }
    if (styleSignature(option.svg) !== styleSignature(correctOption.svg) &&
        typeConfig.errorTags.includes("fill-style-mismatch")) {
      return "fill-style-mismatch";
    }
  }

  return typeConfig.errorTags[
    optionIndex % typeConfig.errorTags.length
  ];
}

function optionFeedback(
  question,
  option,
  correctOption,
  errorTag,
  typeConfig
) {
  const taxonomy = ERROR_TAXONOMY[errorTag];
  const optionNumber = numericOptionValue(option);
  const correctNumber = numericOptionValue(correctOption);
  let comparison = "";

  if (optionNumber != null && correctNumber != null) {
    const gap = Math.abs(correctNumber - optionNumber);
    const direction = optionNumber < correctNumber ? "작습니다" : "큽니다";
    comparison =
      `선택한 값은 정답 계산값보다 ${gap}${option.suffix || ""} ${direction}. `;
  }

  return (
    comparison +
    `${taxonomy.diagnosis} ${taxonomy.action} ` +
    typeConfig.verification
  );
}

function usefulFeedback(value) {
  return typeof value === "string" &&
    value.trim() &&
    value.trim() !== "정답 규칙을 다시 확인하세요.";
}

function questionHints(question, typeConfig) {
  if (Array.isArray(question.hints) && question.hints.length >= 2) {
    return question.hints.slice(0, 2);
  }
  const stepHints = question.typeId?.startsWith("S") &&
      Array.isArray(question.explanationSteps)
    ? question.explanationSteps
      .map(step => step?.text)
      .filter(text => typeof text === "string" && text.trim())
      .slice(0, 2)
    : [];
  return stepHints.length >= 2
    ? stepHints
    : [typeConfig.hint1, typeConfig.hint2];
}

function structuredExplanation(question, typeConfig) {
  if (question.explanation &&
      typeof question.explanation === "object" &&
      typeof question.explanation.rule === "string" &&
      typeof question.explanation.application === "string" &&
      typeof question.explanation.verification === "string") {
    return question.explanation;
  }
  const application = typeof question.explanation === "string"
    ? question.explanation
    : question.explanation?.application || "";
  const verification = Array.isArray(question.explanationSteps) &&
      question.explanationSteps.length
    ? question.explanationSteps.at(-1)?.text || typeConfig.verification
    : typeConfig.verification;
  return {
    rule: typeConfig.rule,
    application,
    verification
  };
}

export function enrichBank(source) {
  if (source.schemaVersion !== 2) {
    throw new Error(`schemaVersion 2만 고도화할 수 있습니다: ${source.schemaVersion}`);
  }
  if (!Array.isArray(source.types) || !Array.isArray(source.questions) ||
      !source.types.length || !source.questions.length) {
    throw new Error("고도화할 문제은행 배열이 비어 있습니다.");
  }
  if (source.types.some(type => type.id === "T19") ||
      source.questions.some(question => question.typeId === "T19")) {
    throw new Error("폐기된 일반지식 유형 T19는 활성 문제은행에 포함할 수 없습니다.");
  }

  const typeConfigs = typeConfigsForSource(source);
  const typeCounts = source.questions.reduce((counts, question) => {
    counts.set(question.typeId, (counts.get(question.typeId) || 0) + 1);
    return counts;
  }, new Map());
  const types = source.types.map(type => {
    const typeConfig = typeConfigs.get(type.id);
    if (!typeConfig) throw new Error(`유형 설정 누락: ${type.id}`);
    return {
      ...type,
      count: typeCounts.get(type.id) || 0,
      domainId: typeConfig.domainId,
      scoreGroup: typeConfig.scoreGroup
    };
  });

  const questions = source.questions.map(question => {
    const typeConfig = typeConfigs.get(question.typeId);
    if (!typeConfig) throw new Error(`문항 유형 설정 누락: ${question.id}`);
    const correctOption = question.options.find(
      option => option.id === question.correctOptionId
    );
    if (!correctOption) throw new Error(`정답 보기 누락: ${question.id}`);
    const alreadyEnriched =
      question.contentQualityVersion === CONTENT_QUALITY_VERSION;
    const questionOrdinal = Number(question.id.split("-").at(-1));
    const sourceDifficulty =
      question.difficultyProfile?.sourceDifficulty ||
      question.authoringDifficultyProfile?.authorLevel ||
      (alreadyEnriched ? questionOrdinal : question.difficulty);
    const profile = difficultyProfile(
      question,
      typeConfig,
      sourceDifficulty
    );
    const options = question.options.map((option, optionIndex) => {
      if (option.id === question.correctOptionId) {
        return {
          ...option,
          errorTag: null,
          feedback: null
        };
      }
      const errorTag = classifyWrongOption(
        question,
        option,
        correctOption,
        optionIndex,
        typeConfig
      );
      return {
        ...option,
        errorTag,
        feedback: usefulFeedback(option.feedback)
          ? option.feedback
          : optionFeedback(
              question,
              option,
              correctOption,
              errorTag,
              typeConfig
            )
      };
    });
    const answerIndex = options.findIndex(
      option => option.id === question.correctOptionId
    );
    const sourceAnswerFeedback =
      usefulFeedback(correctOption.feedback)
        ? correctOption.feedback
        : question.answerFeedback || null;
    const enriched = {
      ...question,
      contentVersion: alreadyEnriched
        ? question.contentVersion
        : (Number(question.contentVersion) || 0) + 1,
      contentQualityVersion: CONTENT_QUALITY_VERSION,
      domainId: typeConfig.domainId,
      scoreGroup: typeConfig.scoreGroup,
      difficulty: profile.overall,
      difficultyProfile: profile,
      options,
      answerIndex,
      answerFeedback: sourceAnswerFeedback,
      explanation: structuredExplanation(question, typeConfig),
      hints: questionHints(question, typeConfig)
    };
    return {
      ...enriched,
      gradingFingerprint: gradingFingerprint(enriched)
    };
  });

  return {
    ...source,
    bankVersion: TARGET_BANK_VERSION,
    contentQualityVersion: CONTENT_QUALITY_VERSION,
    cognitiveDomains: COGNITIVE_DOMAINS,
    errorTaxonomy: Object.entries(ERROR_TAXONOMY).map(
      ([id, value]) => ({ id, label: value.label })
    ),
    types,
    questions
  };
}

export function assertGradingInvariants(source, enriched) {
  const sourceFingerprints = new Map(
    source.questions
      .filter(question => typeof question.gradingFingerprint === "string")
      .map(question => [
        question.id,
        question.gradingFingerprint
      ])
  );
  for (const question of enriched.questions) {
    const sourceFingerprint = sourceFingerprints.get(question.id);
    if (sourceFingerprint &&
        question.gradingFingerprint !== sourceFingerprint) {
      throw new Error(`채점 의미가 변경되었습니다: ${question.id}`);
    }
  }
}

function main() {
  const source = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const enriched = enrichBank(source);
  assertGradingInvariants(source, enriched);
  fs.writeFileSync(
    dataPath,
    `${JSON.stringify(enriched, null, 2)}\n`,
    "utf8"
  );

  console.log(
    `콘텐츠 고도화 완료: ${enriched.types.length}개 유형, ` +
    `${enriched.questions.length}개 문제, ` +
    `${enriched.questions.reduce(
      (sum, question) => sum + question.options.length,
      0
    )}개 보기`
  );
}

if (process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
