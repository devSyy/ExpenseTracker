// 대시보드 거래 리포지토리 (엑셀에서 로드되는 거래내역).
// 명시 저장(autoPersist:false) — 사용자가 "저장하기" 버튼을 누를 때만 영속화.
import { createRepository } from './createRepository'
import { storage } from '~/utils/storage'
import type { Transaction } from '~/utils/types'

const KEY_TX = 'expense:transactions:v1'
const KEY_META = 'expense:txMeta:v1'

interface PersistedShape {
  v: 1
  savedAt: string
  fileName: string
  transactions: Array<Omit<Transaction, 'date'> & { date: string }>
}

interface MetaShape {
  savedAt: string
  fileName: string
  count: number
}

/**
 * 거래 배열은 Date 객체를 가지므로 기본 createRepository로는 다루기 어렵다.
 * 직접 직렬화/역직렬화 로직이 들어간 전용 리포지토리.
 */
export const transactionsRepo = createRepository<Transaction[]>({
  key: KEY_TX,
  default: () => [],
  // raw가 PersistedShape({transactions:[...]}) 또는 plain Transaction[] 둘 다 처리.
  // 잘못된 형태면 null을 반환해 default([])로 떨어지도록.
  migrate: (raw) => {
    if (raw == null) return []
    // PersistedShape인 경우
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      const r = raw as Partial<PersistedShape>
      if (!Array.isArray(r.transactions)) return null
      return r.transactions
        .map((row) => {
          const d = new Date(row.date)
          if (isNaN(d.getTime())) return null
          return { ...row, date: d } as Transaction
        })
        .filter((x): x is Transaction => x !== null)
    }
    // 백업 등에서 plain array가 들어온 경우(date가 string 또는 Date)
    if (Array.isArray(raw)) {
      return raw
        .map((row: any) => {
          if (!row || typeof row !== 'object') return null
          const d = row.date instanceof Date ? row.date : new Date(row.date)
          if (isNaN(d.getTime())) return null
          return { ...row, date: d } as Transaction
        })
        .filter((x): x is Transaction => x !== null)
    }
    return null
  },
  autoPersist: false
})

export const transactionsMetaRepo = createRepository<MetaShape | null>({
  key: KEY_META,
  default: () => null,
  autoPersist: false
})

/**
 * 거래 + 메타를 함께 저장. (Date를 ISOString으로 직렬화)
 * 일반적인 createRepository.save()는 raw 객체 그대로 저장하지만 거래는 Date를 변환해야 하므로
 * 별도 저장 함수를 노출한다.
 */
export function saveTransactions(txs: Transaction[], fileName: string): { ok: boolean; count: number; reason?: string } {
  try {
    const payload: PersistedShape = {
      v: 1,
      savedAt: new Date().toISOString(),
      fileName,
      transactions: txs.map((t) => ({ ...t, date: t.date.toISOString() }))
    }
    if (!storage.set(KEY_TX, payload)) {
      return { ok: false, count: 0, reason: 'storage.set 실패' }
    }
    const meta: MetaShape = { savedAt: payload.savedAt, fileName: payload.fileName, count: payload.transactions.length }
    storage.set(KEY_META, meta)
    transactionsMetaRepo.state.value = meta
    return { ok: true, count: payload.transactions.length }
  } catch (e) {
    return { ok: false, count: 0, reason: (e as Error).message }
  }
}

export function clearTransactions(): void {
  storage.remove(KEY_TX)
  storage.remove(KEY_META)
  transactionsRepo.state.value = []
  transactionsMetaRepo.state.value = null
}
