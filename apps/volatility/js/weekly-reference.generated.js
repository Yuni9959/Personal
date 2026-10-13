// 이 파일은 tools/build-weekly-reference.mjs가 생성합니다. 직접 수정하지 마세요.
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const WEEKLY_VOLATILITY_REFERENCE = deepFreeze({
  "schemaVersion": 3,
  "effectiveFrom": "2026-10-12",
  "effectiveThrough": "2026-10-18",
  "calculatedAt": "2026-10-14T08:30:17.982+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "nasdaq_daily.csv",
  "sourceSha256": "d39699f965c4118bcc3d7761f3d9a802d87883302764702d71f847a9b01ad3d1",
  "fitStart": "2021-10-12",
  "fitEndExclusive": "2026-10-12",
  "holdoutStart": "2025-10-13",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.7582270222654783,
  "bearPercent": 1.9616052377681201,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.7582270222654783,
      "rangeRawSampleCount": 675,
      "rangeUsedSampleCount": 651,
      "safePercent": 0.717228747978263,
      "safeQuantile": 0.25,
      "selectionHitRate": 73.94594594594595,
      "selectionWilson95Low": 72.28054170568446,
      "walkForwardSampleCount": 137,
      "walkForwardHitRate": 83.21167883211679,
      "walkForwardWilson95Low": 76.0669668124677,
      "walkForwardWilson95High": 88.54468998374065,
      "walkForwardBlock95Low": 73.75886524822694,
      "walkForwardBlock95High": 91.53846153846153,
      "currentWindowSampleCount": 675,
      "currentWindowUsedCount": 650
    },
    "bear": {
      "rangeMeanPercent": 1.9616052377681201,
      "rangeRawSampleCount": 586,
      "rangeUsedSampleCount": 557,
      "safePercent": 0.8247231356332962,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.15500442869796,
      "selectionWilson95Low": 73.33096821535716,
      "walkForwardSampleCount": 117,
      "walkForwardHitRate": 78.63247863247864,
      "walkForwardWilson95Low": 70.3574814882634,
      "walkForwardWilson95High": 85.0870659823322,
      "walkForwardBlock95Low": 69.35483870967742,
      "walkForwardBlock95High": 87.90322580645162,
      "currentWindowSampleCount": 586,
      "currentWindowUsedCount": 560
    }
  },
  "exAnte": {
    "up": {
      "safePercent": 0.3589690868095818,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.5144669044788,
      "selectionWilson95Low": 73.29375160998345,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 74.01574803149606,
      "walkForwardWilson95Low": 68.2931068961746,
      "walkForwardWilson95High": 79.02279046106158,
      "walkForwardBlock95Low": 69.01722521677995,
      "walkForwardBlock95High": 78.74015748031496,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1210
    },
    "down": {
      "safePercent": 0.29515938606847697,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.93063812921126,
      "selectionWilson95Low": 73.71613011143813,
      "walkForwardSampleCount": 254,
      "walkForwardHitRate": 75.19685039370079,
      "walkForwardWilson95Low": 69.53671686030908,
      "walkForwardWilson95High": 80.10619184236494,
      "walkForwardBlock95Low": 69.140625,
      "walkForwardBlock95High": 80.70866141732283,
      "currentWindowSampleCount": 1261,
      "currentWindowUsedCount": 1201
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 20.9%, 하락 26.0%로 안전선에 부적합"
  }
});
