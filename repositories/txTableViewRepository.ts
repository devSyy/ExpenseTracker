// 거래내역 테이블의 보기 설정 리포지토리 (컬럼 표시 여부).
//
// 데이터가 아니라 화면 설정이지만, 매번 새로고침마다 껐던 컬럼이 되살아나면
// 쓸모가 없으므로 영속화한다. 편집 즉시 저장(autoPersist)이라 '저장' 버튼과 무관하다
// — 거래 데이터의 명시 저장 규칙과 섞이지 않게 키를 분리해 둔 이유다.
import { createRepository } from './createRepository'
import { ALL_COLUMN_KEYS, HIDEABLE_COLUMN_KEYS, type ColumnKey } from '~/utils/txTable'

const KEY = 'expense:txTableView:v1'

export interface TxTableView {
  /** 표시할 컬럼 키 목록. 숨길 수 없는 컬럼은 여기 없어도 항상 그려진다 */
  columns: ColumnKey[]
}

function defaultTxTableView(): TxTableView {
  return { columns: [...ALL_COLUMN_KEYS] }
}

export const txTableViewRepo = createRepository<TxTableView>({
  key: KEY,
  default: defaultTxTableView,
  migrate: (raw) => {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Partial<TxTableView>
    if (!Array.isArray(r.columns)) return defaultTxTableView()
    // 저장된 값에 모르는 키가 섞여 있어도(구버전/수동 편집) 알려진 키만 남긴다
    const known = new Set<string>(ALL_COLUMN_KEYS)
    const cols = r.columns.filter((c): c is ColumnKey => typeof c === 'string' && known.has(c))
    // 숨길 수 없는 컬럼은 저장값과 무관하게 항상 포함
    for (const c of ALL_COLUMN_KEYS) {
      if (!HIDEABLE_COLUMN_KEYS.includes(c) && !cols.includes(c)) cols.push(c)
    }
    return { columns: cols }
  }
})

export { defaultTxTableView, KEY as TX_TABLE_VIEW_KEY }
