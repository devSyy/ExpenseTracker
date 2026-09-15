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

/** 가족 멤버별 마지막 저장 정보 */
export interface MemberMeta {
  savedAt: string
  fileName: string
  count: number
}

export interface MetaShape {
  savedAt: string
  fileName: string
  count: number
  /** 멤버별 마지막 저장 정보 (구버전 데이터에는 없을 수 있음) */
  byMember?: Record<string, MemberMeta>
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
          // excluded: 구버전 데이터에는 없으므로 false로 정규화 (기본 = 지출에 포함)
          const r = row as { excluded?: unknown; negativeAmount?: unknown; refund?: unknown; canceled?: unknown }
          return {
            ...row,
            date: d,
            excluded: r.excluded === true,
            // 구버전 canceled(= 음수면 무조건 환불) → negativeAmount 로 이관
            negativeAmount: r.negativeAmount === true || r.canceled === true,
            refund: r.refund === true
          } as Transaction
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
          return {
            ...row,
            date: d,
            excluded: row.excluded === true,
            negativeAmount: row.negativeAmount === true || row.canceled === true,
            refund: row.refund === true
          } as Transaction
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
 * 거래 배열 → 저장 형식(PersistedShape). **저장소에 쓰지는 않는다.**
 * saveTransactions()와 백업 내보내기가 같은 형식을 쓰도록 한 곳에 둔다.
 */
export function serializeTransactions(txs: Transaction[], fileName: string): PersistedShape {
  return {
    v: 1,
    savedAt: new Date().toISOString(),
    fileName,
    transactions: txs.map((t) => ({ ...t, date: t.date.toISOString() }))
  }
}

/**
 * 거래 + 메타를 함께 저장. (Date를 ISOString으로 직렬화)
 * 일반적인 createRepository.save()는 raw 객체 그대로 저장하지만 거래는 Date를 변환해야 하므로
 * 별도 저장 함수를 노출한다.
 */
export function saveTransactions(
  txs: Transaction[],
  fileName: string,
  /** 이번 저장이 특정 멤버 단위 저장이면 그 멤버의 메타를 함께 갱신한다. */
  memberUpdate?: { memberId: string; fileName: string; count: number },
  /**
   * 전체 저장(편집 후 "저장" 버튼)일 때 멤버별 메타를 **방금 저장한 데이터로 다시 맞춘다**.
   * memberId → 건수. 이 맵에 없는 멤버는 저장된 데이터에 거래가 하나도 없다는 뜻이므로 메타에서 지운다.
   * 넘기지 않으면(undefined) 기존 메타를 그대로 둔다 — 멤버 단위 저장 경로의 동작은 변하지 않는다.
   */
  memberCounts?: Record<string, number>
): { ok: boolean; count: number; reason?: string } {
  try {
    const payload = serializeTransactions(txs, fileName)
    if (!storage.set(KEY_TX, payload)) {
      return { ok: false, count: 0, reason: '브라우저 저장 공간에 쓸 수 없습니다. (용량 초과 또는 시크릿 모드)' }
    }
    const byMember: Record<string, MemberMeta> = { ...(transactionsMetaRepo.state.value?.byMember ?? {}) }
    if (memberCounts) {
      // 편집 후 전체 저장 — 저장된 실제 건수로 멤버별 메타를 동기화한다.
      // (파일명은 그 멤버가 마지막에 올린 파일 이름이므로 보존)
      for (const id of Object.keys(byMember)) {
        if (!(id in memberCounts)) delete byMember[id]
      }
      for (const [id, count] of Object.entries(memberCounts)) {
        byMember[id] = {
          savedAt: payload.savedAt,
          fileName: byMember[id]?.fileName ?? fileName,
          count
        }
      }
    }
    if (memberUpdate) {
      byMember[memberUpdate.memberId] = {
        savedAt: payload.savedAt,
        fileName: memberUpdate.fileName,
        count: memberUpdate.count
      }
    }
    const meta: MetaShape = {
      savedAt: payload.savedAt,
      fileName: payload.fileName,
      count: payload.transactions.length,
      byMember
    }
    storage.set(KEY_META, meta)
    transactionsMetaRepo.state.value = meta
    return { ok: true, count: payload.transactions.length }
  } catch (e) {
    return { ok: false, count: 0, reason: (e as Error).message }
  }
}

/** 특정 멤버의 마지막 저장 메타 조회 (없으면 null) */
export function memberMeta(memberId: string): MemberMeta | null {
  return transactionsMetaRepo.state.value?.byMember?.[memberId] ?? null
}

export function clearTransactions(): void {
  storage.remove(KEY_TX)
  storage.remove(KEY_META)
  transactionsRepo.state.value = []
  transactionsMetaRepo.state.value = null
}
