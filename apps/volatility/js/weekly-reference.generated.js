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
  "calculatedAt": "2026-11-09T07:00:27.067+09:00",
  "sourceSymbol": "NQ continuous proxy",
  "sourceDataset": "Yahoo NQ daily (cloud)",
  "sourceSha256": "a528002c692b0d2539b352c0d483e556f7de39407f1112354fb48aed076d0f0c",
  "fitStart": "2021-11-09",
  "fitEndExclusive": "2026-11-09",
  "holdoutStart": "2025-11-10",
  "lookbackYears": 5,
  "method": "5년·2σ 정제·월요일 주간 고정·selection 70% Wilson 하한 정책",
  "bullPercent": 1.777345088851528,
  "bearPercent": 1.9896951371754947,
  "directions": {
    "bull": {
      "rangeMeanPercent": 1.777345088851528,
      "rangeRawSampleCount": 665,
      "rangeUsedSampleCount": 640,
      "safePercent": 0.7235285661983911,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.04881550610195,
      "selectionWilson95Low": 72.38870761497078,
      "walkForwardSampleCount": 133,
      "walkForwardHitRate": 81.95488721804512,
      "walkForwardWilson95Low": 74.55242198663831,
      "walkForwardWilson95High": 87.56325606337215,
      "walkForwardBlock95Low": 72.85571428571428,
      "walkForwardBlock95High": 89.91612924239463,
      "currentWindowSampleCount": 665,
      "currentWindowUsedCount": 640
    },
    "bear": {
      "rangeMeanPercent": 1.9896951371754947,
      "rangeRawSampleCount": 592,
      "rangeUsedSampleCount": 565,
      "safePercent": 0.835370429201463,
      "safeQuantile": 0.25,
      "selectionHitRate": 75.20952801058668,
      "selectionWilson95Low": 73.39040911917033,
      "walkForwardSampleCount": 117,
      "walkForwardHitRate": 80.34188034188034,
      "walkForwardWilson95Low": 72.22629728068515,
      "walkForwardWilson95High": 86.52837242696097,
      "walkForwardBlock95Low": 70.26971186062096,
      "walkForwardBlock95High": 89.39486326681447,
      "currentWindowSampleCount": 592,
      "currentWindowUsedCount": 567
    }
  },
  "exAnte": {
    "up": {
      "safePercent": 0.3554602242143373,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.51638373470193,
      "selectionWilson95Low": 73.29814413826139,
      "walkForwardSampleCount": 250,
      "walkForwardHitRate": 74,
      "walkForwardWilson95Low": 68.22862349629212,
      "walkForwardWilson95High": 79.04497812792654,
      "walkForwardBlock95Low": 68.44208369283865,
      "walkForwardBlock95High": 79.83870967741935,
      "currentWindowSampleCount": 1257,
      "currentWindowUsedCount": 1206
    },
    "down": {
      "safePercent": 0.31105262685022,
      "safeQuantile": 0.25,
      "selectionHitRate": 74.93091196210028,
      "selectionWilson95Low": 73.71884395295116,
      "walkForwardSampleCount": 250,
      "walkForwardHitRate": 77.60000000000001,
      "walkForwardWilson95Low": 72.03647189638117,
      "walkForwardWilson95High": 82.32816997147029,
      "walkForwardBlock95Low": 70.7509881422925,
      "walkForwardBlock95High": 83.66695914753682,
      "currentWindowSampleCount": 1257,
      "currentWindowUsedCount": 1199
    }
  },
  "rejectedIllustration": {
    "percent": 1.409,
    "reason": "최근 52주 방향 미확정 도달률이 상승 21.6%, 하락 27.6%로 안전선에 부적합"
  }
});
