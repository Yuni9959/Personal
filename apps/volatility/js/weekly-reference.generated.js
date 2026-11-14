// 이 파일은 tools/build-weekly-reference.mjs가 생성합니다. 직접 수정하지 마세요.
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze({
  "schemaVersion": 3,
  "effectiveFrom": "2026-11-09",
  "effectiveThrough": "2026-11-15",
  "calculatedAt": "2026-11-14T20:30:20.354+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "nasdaq_daily.csv",
  "sourceSha256": "b0f5a0bd9aecc24abf2076d100949bdf3a4b0257b3c571fe55e91b90400be7b2",
  "fitStart": "2021-11-09",
  "fitEndExclusive": "2026-11-09",
  "holdoutStart": "2025-11-10",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.7739397309363785,
  "bearPercent": 1.985536227231729,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.7739397309363785,
      "rangeRawSampleCount": 667,
      "rangeUsedSampleCount": 642,
      "safePercent": 0.7230984219422399,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.04881550610195,
      "selectionWilson95Low": 72.38870761497078,
      "walkForwardSampleCount": 135,
      "walkForwardHitRate": 82.22222222222221,
      "walkForwardWilson95Low": 74.90902943392975,
      "walkForwardWilson95High": 87.75236921382977,
      "walkForwardBlock95Low": 72.79399259703881,
      "walkForwardBlock95High": 90.37111111111109,
      "currentWindowSampleCount": 667,
      "currentWindowUsedCount": 642
    },
    "bear": {
      "rangeMeanPercent": 1.985536227231729,
      "rangeRawSampleCount": 594,
      "rangeUsedSampleCount": 567,
      "safePercent": 0.833385992900957,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.20952801058668,
      "selectionWilson95Low": 73.39040911917033,
      "walkForwardSampleCount": 119,
      "walkForwardHitRate": 79.83193277310924,
      "walkForwardWilson95Low": 71.74226214669758,
      "walkForwardWilson95High": 86.0558140741615,
      "walkForwardBlock95Low": 69.74600495936079,
      "walkForwardBlock95High": 89.07563025210085,
      "currentWindowSampleCount": 594,
      "currentWindowUsedCount": 568
    }
  },
  "exAnte": {
    "up": {
      "safePercent": 0.35389289729758133,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.51638373470193,
      "selectionWilson95Low": 73.29814413826139,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 73.22834645669292,
      "walkForwardWilson95Low": 67.46679149008862,
      "walkForwardWilson95High": 78.297764970189,
      "walkForwardBlock95Low": 67.98418972332016,
      "walkForwardBlock95High": 78.6006444071915,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1210
    },
    "down": {
      "safePercent": 0.3078826658051705,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.93091196210028,
      "selectionWilson95Low": 73.71884395295116,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 76.77165354330708,
      "walkForwardWilson95Low": 71.20294825531228,
      "walkForwardWilson95High": 81.54264224127886,
      "walkForwardBlock95Low": 70,
      "walkForwardBlock95High": 82.81390064741035,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1202
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 21.3%, 하락 27.2%로 안전선에 부적합"
  }
});
