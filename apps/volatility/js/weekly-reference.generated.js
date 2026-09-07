// 이 파일은 tools/build-weekly-reference.mjs가 생성합니다. 직접 수정하지 마세요.
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze({
  "schemaVersion": 3,
  "effectiveFrom": "2026-09-07",
  "effectiveThrough": "2026-09-13",
  "calculatedAt": "2026-09-07T09:43:14.803+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "nasdaq_daily.csv",
  "sourceSha256": "82403275635765e8284c7388a9bb2a3dc8ce866a87da1c14e9adaec88d39f185",
  "fitStart": "2021-09-07",
  "fitEndExclusive": "2026-09-07",
  "holdoutStart": "2025-09-08",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.7627895050676619,
  "bearPercent": 1.962832938936781,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.7627895050676619,
      "rangeRawSampleCount": 670,
      "rangeUsedSampleCount": 646,
      "safePercent": 0.7132796780684104,
      "safeQuantile": 0.25,
      "selectionHitRate": 73.98550724637681,
      "selectionWilson95Low": 72.31624730610679,
      "walkForwardSampleCount": 136,
      "walkForwardHitRate": 80.88235294117648,
      "walkForwardWilson95Low": 73.46163333430687,
      "walkForwardWilson95High": 86.60638991744246,
      "walkForwardBlock95Low": 70.14749089199671,
      "walkForwardBlock95High": 90.22602237300568,
      "currentWindowSampleCount": 670,
      "currentWindowUsedCount": 645
    },
    "bear": {
      "rangeMeanPercent": 1.962832938936781,
      "rangeRawSampleCount": 591,
      "rangeUsedSampleCount": 562,
      "safePercent": 0.8149668985167182,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.22241992882563,
      "selectionWilson95Low": 73.39574645364765,
      "walkForwardSampleCount": 118,
      "walkForwardHitRate": 77.11864406779661,
      "walkForwardWilson95Low": 68.75595657058834,
      "walkForwardWilson95High": 83.7713199570052,
      "walkForwardBlock95Low": 67.34595761381476,
      "walkForwardBlock95High": 86.32478632478633,
      "currentWindowSampleCount": 591,
      "currentWindowUsedCount": 565
    }
  },
  "exAnte": {
    "up": {
      "safePercent": 0.3590953950976702,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.50707030472017,
      "selectionWilson95Low": 73.28316564006315,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 74.80314960629921,
      "walkForwardWilson95Low": 69.12161770638883,
      "walkForwardWilson95High": 79.74562054780591,
      "walkForwardBlock95Low": 69.56521739130434,
      "walkForwardBlock95High": 79.37743190661479,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1211
    },
    "down": {
      "safePercent": 0.30040016787418256,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.02489543915554,
      "selectionWilson95Low": 73.80875141272939,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 74.01574803149606,
      "walkForwardWilson95Low": 68.2931068961746,
      "walkForwardWilson95High": 79.02279046106158,
      "walkForwardBlock95Low": 67.5997233201581,
      "walkForwardBlock95High": 79.92125984251969,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1200
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 19.3%, 하락 25.2%로 안전선에 부적합"
  }
});
