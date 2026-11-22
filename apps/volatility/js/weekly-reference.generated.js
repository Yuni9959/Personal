// 이 파일은 tools/build-weekly-reference.mjs가 생성합니다. 직접 수정하지 마세요.
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze({
  "schemaVersion": 3,
  "effectiveFrom": "2026-11-23",
  "effectiveThrough": "2026-11-29",
  "calculatedAt": "2026-11-23T08:30:21.923+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "nasdaq_daily.csv",
  "sourceSha256": "4e278eac93d7cca6db07c7aff314a9f53b54a74b77a6b273793daecdae46e62c",
  "fitStart": "2021-11-23",
  "fitEndExclusive": "2026-11-23",
  "holdoutStart": "2025-11-24",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.787654801319788,
  "bearPercent": 1.9994987520527547,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.787654801319788,
      "rangeRawSampleCount": 664,
      "rangeUsedSampleCount": 639,
      "safePercent": 0.7230984219422399,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.07673001075653,
      "selectionWilson95Low": 72.41806120948372,
      "walkForwardSampleCount": 135,
      "walkForwardHitRate": 82.22222222222221,
      "walkForwardWilson95Low": 74.90902943392975,
      "walkForwardWilson95High": 87.75236921382977,
      "walkForwardBlock95Low": 72.66172999100719,
      "walkForwardBlock95High": 90.625,
      "currentWindowSampleCount": 664,
      "currentWindowUsedCount": 638
    },
    "bear": {
      "rangeMeanPercent": 1.9994987520527547,
      "rangeRawSampleCount": 597,
      "rangeUsedSampleCount": 569,
      "safePercent": 0.8386307065521481,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.24186455584872,
      "selectionWilson95Low": 73.4263299100003,
      "walkForwardSampleCount": 119,
      "walkForwardHitRate": 80.67226890756302,
      "walkForwardWilson95Low": 72.66474889478867,
      "walkForwardWilson95High": 86.76144214919321,
      "walkForwardBlock95Low": 70.68828680897646,
      "walkForwardBlock95High": 90.00190839694653,
      "currentWindowSampleCount": 597,
      "currentWindowUsedCount": 571
    }
  },
  "exAnte": {
    "up": {
      "safePercent": 0.3531717540216948,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.52718676122932,
      "selectionWilson95Low": 73.310324273798,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 73.22834645669292,
      "walkForwardWilson95Low": 67.46679149008862,
      "walkForwardWilson95High": 78.297764970189,
      "walkForwardBlock95Low": 68,
      "walkForwardBlock95High": 78.43137254901961,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1209
    },
    "down": {
      "safePercent": 0.31468533831993273,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.96059889676911,
      "selectionWilson95Low": 73.75019047808516,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 76.77165354330708,
      "walkForwardWilson95Low": 71.20294825531228,
      "walkForwardWilson95High": 81.54264224127886,
      "walkForwardBlock95Low": 70.19607843137254,
      "walkForwardBlock95High": 82.74647058823527,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1207
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 21.3%, 하락 28.0%로 안전선에 부적합"
  }
});
