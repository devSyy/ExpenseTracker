// 자산 현황 컴포저블 — assetsRepo 위의 액션 레이어.
import { computed } from 'vue'
import { assetsRepo, defaultAssetsState } from '~/repositories/assetsRepository'

export interface AssetCategoryDef {
  key: string
  label: string
  color: string
}

export const ASSET_CATEGORIES: AssetCategoryDef[] = [
  { key: 'cash', label: '현금 및 예금', color: '#3b82f6' },
  { key: 'stocks', label: '주식 및 펀드', color: '#10b981' },
  { key: 'realEstate', label: '부동산', color: '#f59e0b' },
  { key: 'car', label: '자동차', color: '#ef4444' },
  { key: 'other', label: '기타 자산', color: '#94a3b8' }
]

export interface AssetEntry {
  amount: number
  note: string
}

export interface TrendPoint {
  ym: string
  total: number
}

export interface AssetState {
  baseDate: string
  entries: Record<string, AssetEntry>
  trend: TrendPoint[]
  remarks: string[]
}

const state = assetsRepo.state

const total = computed<number>(() =>
  ASSET_CATEGORIES.reduce((s, c) => s + (state.value.entries[c.key]?.amount ?? 0), 0)
)

const breakdown = computed(() =>
  ASSET_CATEGORIES.map((c) => {
    const amount = state.value.entries[c.key]?.amount ?? 0
    const note = state.value.entries[c.key]?.note ?? ''
    const share = total.value > 0 ? amount / total.value : 0
    return { ...c, amount, note, share }
  })
)

function setEntry(key: string, amount: number, note: string) {
  state.value = {
    ...state.value,
    entries: {
      ...state.value.entries,
      [key]: { amount: Math.max(0, Number(amount) || 0), note: note.trim() }
    }
  }
}

function setBaseDate(date: string) {
  state.value = { ...state.value, baseDate: date }
}

function snapshotCurrent() {
  const ym = state.value.baseDate.slice(0, 7)
  const t = total.value
  const idx = state.value.trend.findIndex((p) => p.ym === ym)
  const next = state.value.trend.slice()
  if (idx === -1) {
    next.push({ ym, total: t })
    next.sort((a, b) => a.ym.localeCompare(b.ym))
  } else {
    next[idx] = { ym, total: t }
  }
  state.value = { ...state.value, trend: next }
}

function removeTrendPoint(ym: string) {
  state.value = { ...state.value, trend: state.value.trend.filter((p) => p.ym !== ym) }
}

function addRemark(text: string): boolean {
  const v = (text ?? '').trim()
  if (!v) return false
  state.value = { ...state.value, remarks: [...state.value.remarks, v] }
  return true
}

function updateRemark(idx: number, text: string) {
  if (idx < 0 || idx >= state.value.remarks.length) return
  const v = (text ?? '').trim()
  const next = state.value.remarks.slice()
  if (!v) next.splice(idx, 1); else next[idx] = v
  state.value = { ...state.value, remarks: next }
}

function removeRemark(idx: number) {
  state.value = { ...state.value, remarks: state.value.remarks.filter((_, i) => i !== idx) }
}

function resetToDefaults() {
  state.value = defaultAssetsState()
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function useAssets() {
  return {
    state,
    total,
    breakdown,
    setEntry,
    setBaseDate,
    snapshotCurrent,
    removeTrendPoint,
    addRemark,
    updateRemark,
    removeRemark,
    resetToDefaults,
    ASSET_CATEGORIES,
    todayStr
  }
}
