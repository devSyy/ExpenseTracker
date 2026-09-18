// 저장된(=화면에 보이는) 거래 내역을 엑셀(.xlsx)로 내보낸다.
//
// 열 구성은 업로드 양식(utils/sampleTemplate.SAMPLE_HEADERS)과 **완전히 동일**하다.
// 따라서 내려받은 파일을 그대로 다시 업로드하면 같은 거래가 그대로 복원된다(라운드트립).
//  - 금액: 저장은 절대값 + negativeAmount 플래그이므로, 음수 거래(환불 포함)는 음수로 되돌려 쓴다.
//    재업로드 시 파서가 다시 음수로 읽고 환불 짝짓기를 수행한다.
//  - 양식에 없는 메타(가족, 지출계산 제외 플래그 등)는 담지 않는다. 전체 백업이 필요하면
//    설정 > 백업·복원의 JSON 내보내기를 쓴다.
import { SAMPLE_HEADERS, SAMPLE_SHEET_NAME } from '~/utils/sampleTemplate'
import { downloadBytes, XLSX_MIME } from '~/utils/download'
import type { Transaction } from '~/utils/types'

/**
 * 날짜 → 'YYYY-MM-DD' (로컬 기준 — toISOString()은 UTC라 KST에서 하루 밀린다).
 * 저장소 복원 경로에 따라 Date가 아닌 값이 들어올 수 있으므로 방어적으로 변환한다.
 */
function fmtDate(raw: Date | string | number): string {
  const d = raw instanceof Date ? raw : new Date(raw)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 파일명에 쓸 오늘 날짜 (YYYYMMDD) */
function stamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

export function defaultExportFileName(date = new Date()): string {
  return `가계부-거래내역-${stamp(date)}.xlsx`
}

/** 거래 → 업로드 양식과 같은 순서의 셀 배열 */
export function buildExportRows(txs: Transaction[]): (string | number)[][] {
  return txs.map((t) => {
    const amount = Math.abs(Number(t.amount) || 0)
    return [
      fmtDate(t.date),
      t.description ?? '',
      t.negativeAmount ? -amount : amount,
      t.category ?? '',
      t.paymentMethod ?? '',
      t.costType ?? '',
      t.note ?? ''
    ]
  })
}

export async function buildTransactionsWorkbook(txs: Transaction[]): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const aoa: (string | number)[][] = [[...SAMPLE_HEADERS], ...buildExportRows(txs)]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 24 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, SAMPLE_SHEET_NAME)
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array
}

/** 거래 목록을 .xlsx로 내려받는다. 반환값은 실제로 쓴 행 수. (클라이언트 전용) */
export async function downloadTransactionsXlsx(
  txs: Transaction[],
  fileName = defaultExportFileName()
): Promise<number> {
  const bytes = await buildTransactionsWorkbook(txs)
  downloadBytes(bytes, fileName, XLSX_MIME)
  return txs.length
}
