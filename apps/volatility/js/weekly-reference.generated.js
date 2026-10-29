// 이 파일은 tools/build-weekly-reference.mjs가 생성합니다. 직접 수정하지 마세요.
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze({
  "schemaVersion": 3,
  "effectiveFrom": "2026-10-26",
  "effectiveThrough": "2026-11-01",
  "calculatedAt": "2026-10-30T08:30:25.198+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "nasdaq_daily.csv",
  "sourceSha256": "0891269df7e85b0bb732289150f1e2b593e6996b0bc401db3be6be2e8144e4c7",
  "fitStart": "2021-10-26",
  "fitEndExclusive": "2026-10-26",
  "holdoutStart": "2025-10-27",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.7616579639150975,
  "bearPercent": 1.9684536830191413,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.7616579639150975,
      "rangeRawSampleCount": 671,
      "rangeUsedSampleCount": 647,
      "safePercent": 0.7151021593428823,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.00215749730313,
      "selectionWilson95Low": 72.33964601657787,
      "walkForwardSampleCount": 134,
      "walkForwardHitRate": 82.08955223880598,
      "walkForwardWilson95Low": 74.73197986028968,
      "walkForwardWilson95High": 87.65853801131081,
      "walkForwardBlock95Low": 73.10278514588859,
      "walkForwardBlock95High": 90.16508082081852,
      "currentWindowSampleCount": 671,
      "currentWindowUsedCount": 646
    },
    "bear": {
      "rangeMeanPercent": 1.9684536830191413,
      "rangeRawSampleCount": 590,
      "rangeUsedSampleCount": 561,
      "safePercent": 0.8312600561934664,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.15473032714411,
      "selectionWilson95Low": 73.33233735974284,
      "walkForwardSampleCount": 120,
      "walkForwardHitRate": 80,
      "walkForwardWilson95Low": 71.96332649371804,
      "walkForwardWilson95High": 86.17552352115975,
      "walkForwardBlock95Low": 69.49152542372882,
      "walkForwardBlock95High": 89.16666666666667,
      "currentWindowSampleCount": 590,
      "currentWindowUsedCount": 564
    }
  },
  "exAnte": {
    "up": {
      "safePercent": 0.3554602242143373,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.5253164556962,
      "selectionWilson95Low": 73.30598657364986,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 73.22834645669292,
      "walkForwardWilson95Low": 67.46679149008862,
      "walkForwardWilson95High": 78.297764970189,
      "walkForwardBlock95Low": 67.8714859437751,
      "walkForwardBlock95High": 78.29504062762678,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1210
    },
    "down": {
      "safePercent": 0.30047059620137456,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.94066455696202,
      "selectionWilson95Low": 73.72752750769767,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 75.59055118110236,
      "walkForwardWilson95Low": 69.95239012242611,
      "walkForwardWilson95High": 80.46618902872717,
      "walkForwardBlock95Low": 69.68503937007874,
      "walkForwardBlock95High": 81.17647058823529,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1201
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 20.5%, 하락 26.4%로 안전선에 부적합"
  }
});
