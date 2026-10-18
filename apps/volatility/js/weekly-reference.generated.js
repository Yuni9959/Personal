// 이 파일은 tools/build-weekly-reference.mjs가 생성합니다. 직접 수정하지 마세요.
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze({
  "schemaVersion": 3,
  "effectiveFrom": "2026-10-19",
  "effectiveThrough": "2026-10-25",
  "calculatedAt": "2026-10-19T08:30:20.772+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "nasdaq_daily.csv",
  "sourceSha256": "aa569bdd86d23ebc43979ff36da5cde7f8862ed144ce2b9b673f13e10931915b",
  "fitStart": "2021-10-19",
  "fitEndExclusive": "2026-10-19",
  "holdoutStart": "2025-10-20",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.7598345666453783,
  "bearPercent": 1.963351839863389,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.7598345666453783,
      "rangeRawSampleCount": 671,
      "rangeUsedSampleCount": 647,
      "safePercent": 0.717228747978263,
      "safeQuantile": 0.25,
      "selectionHitRate": 73.97408207343412,
      "selectionWilson95Low": 72.31012536754167,
      "walkForwardSampleCount": 134,
      "walkForwardHitRate": 82.83582089552239,
      "walkForwardWilson95Low": 75.55980872172323,
      "walkForwardWilson95High": 88.28165142596099,
      "walkForwardBlock95Low": 73.57037815126051,
      "walkForwardBlock95High": 91.33929077210672,
      "currentWindowSampleCount": 671,
      "currentWindowUsedCount": 646
    },
    "bear": {
      "rangeMeanPercent": 1.963351839863389,
      "rangeRawSampleCount": 590,
      "rangeUsedSampleCount": 561,
      "safePercent": 0.8275201140304447,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.17699115044248,
      "selectionWilson95Low": 73.3542693582751,
      "walkForwardSampleCount": 120,
      "walkForwardHitRate": 79.16666666666666,
      "walkForwardWilson95Low": 71.05232156701865,
      "walkForwardWilson95High": 85.4715603918903,
      "walkForwardBlock95Low": 69.56521739130434,
      "walkForwardBlock95High": 87.93183269476371,
      "currentWindowSampleCount": 590,
      "currentWindowUsedCount": 564
    }
  },
  "exAnte": {
    "up": {
      "safePercent": 0.3554602242143373,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.53969510987923,
      "selectionWilson95Low": 73.31996504580268,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 72.83464566929135,
      "walkForwardWilson95Low": 67.05443779853485,
      "walkForwardWilson95High": 77.93444821326348,
      "walkForwardBlock95Low": 67.33067729083665,
      "walkForwardBlock95High": 78.125,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1210
    },
    "down": {
      "safePercent": 0.3001888828926066,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.93565630568204,
      "selectionWilson95Low": 73.7218343290319,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 75.59055118110236,
      "walkForwardWilson95Low": 69.95239012242611,
      "walkForwardWilson95High": 80.46618902872717,
      "walkForwardBlock95Low": 69.56521739130434,
      "walkForwardBlock95High": 81.17830882352939,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1201
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 20.1%, 하락 26.4%로 안전선에 부적합"
  }
});
