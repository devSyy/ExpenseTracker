// 자산 현황 리포지토리.
import { createRepository } from './createRepository'
import type { AssetState } from '~/composables/useAssets'

const KEY = 'assets:state:v1'

function defaultAssetsState(): AssetState {
  return {
    baseDate: '2024-06-30',
    entries: {
      cash:       { amount: 220_000_000, note: '' },
      stocks:     { amount: 350_000_000, note: '' },
      realEstate: { amount: 950_000_000, note: '아파트 1채' },
      car:        { amount:  70_000_000, note: '승용차 1대' },
      other:      { amount: 252_500_000, note: '보험, 적금 등' }
    },
    trend: [
      { ym: '2024-01', total: 1_450_000_000 },
      { ym: '2024-02', total: 1_512_000_000 },
      { ym: '2024-03', total: 1_580_000_000 },
      { ym: '2024-04', total: 1_630_000_000 },
      { ym: '2024-05', total: 1_751_000_000 },
      { ym: '2024-06', total: 1_842_500_000 }
    ],
    remarks: [
      '부동산 시세 변동 반영 (2024년 6월 기준)',
      '예금 금리는 연 3.5% 기준',
      '주식 및 펀드는 평가금액 기준',
      '기타 자산은 보험 해지환급금, 적금, 연금 등을 포함'
    ]
  }
}

export const assetsRepo = createRepository<AssetState>({
  key: KEY,
  default: defaultAssetsState,
  migrate: (raw) => {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Partial<AssetState>
    const def = defaultAssetsState()
    return {
      baseDate: typeof r.baseDate === 'string' ? r.baseDate : def.baseDate,
      entries: { ...def.entries, ...(r.entries ?? {}) },
      trend: Array.isArray(r.trend) ? r.trend : def.trend,
      remarks: Array.isArray(r.remarks) ? r.remarks.filter((x) => typeof x === 'string') : def.remarks
    }
  }
})

export { defaultAssetsState }
