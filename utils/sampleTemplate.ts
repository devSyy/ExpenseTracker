// 업로드 양식 샘플(.xlsx) 생성 · 다운로드
//
// 파서(utils/parseExcel.ts)가 인식하는 표준 열 이름과 값 예시를 그대로 담는다.
// 카테고리·결제수단은 사용자가 설정한 목록을 우선 사용하고, 비어 있으면 기본값을 쓴다.
// 시트는 1개만 만든다 — 안내용 시트를 덧붙이면 업로드 시 "여러 시트" 경고가 뜬다.
import { DEFAULT_CATEGORIES, DEFAULT_PAYMENT_METHODS } from '~/utils/types'
import { downloadBytes, XLSX_MIME } from '~/utils/download'

/** 샘플 양식의 헤더 (parseExcel 의 HEADER_ALIASES 에 정확히 일치하는 이름들) */
export const SAMPLE_HEADERS = ['날짜', '내용', '금액', '카테고리', '결제수단', '구분', '비고'] as const

export const SAMPLE_SHEET_NAME = '가계부'
export const SAMPLE_FILE_NAME = '가계부-업로드-양식.xlsx'

export interface SampleTemplateOptions {
  /** 카테고리 관리에 등록된 이름들 (없으면 기본 카테고리) */
  categories?: string[]
  /** 결제수단 관리에 등록된 이름들 (없으면 기본 결제수단) */
  payments?: string[]
  /** 샘플 날짜의 기준일 (기본: 오늘) */
  baseDate?: Date
  fileName?: string
}

function fmtDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 헤더 1행 + 예시 데이터 행들 */
export function buildSampleRows(opts: SampleTemplateOptions = {}): (string | number)[][] {
  const catList = (opts.categories ?? []).filter(Boolean)
  const payList = (opts.payments ?? []).filter(Boolean)
  const cats = catList.length > 0 ? catList : [...DEFAULT_CATEGORIES]
  const pays = payList.length > 0 ? payList : [...DEFAULT_PAYMENT_METHODS]

  // 원하는 이름이 사용자의 목록에 없으면 목록에서 하나를 돌려 쓴다.
  const cat = (want: string, i: number) => (cats.includes(want) ? want : cats[i % cats.length]!)
  const pay = (want: string, i: number) => (pays.includes(want) ? want : pays[i % pays.length]!)

  const base = opts.baseDate ?? new Date()
  const day = (back: number) => {
    const d = new Date(base)
    d.setDate(d.getDate() - back)
    return fmtDate(d)
  }

  return [
    [day(0), '점심 식사', 9000, cat('식비', 0), pay('롯데카드', 0), '변동비', ''],
    [day(1), '이마트 장보기', 64500, cat('마트', 1), pay('삼성카드', 1), '변동비', ''],
    [day(2), '지하철 교통카드 충전', 50000, cat('교통', 2), pay('신한체크카드', 2), '변동비', ''],
    [day(3), '영화 예매', 28000, cat('문화/여가', 3), pay('롯데카드', 0), '변동비', ''],
    [day(4), '영화 예매 취소', -28000, cat('문화/여가', 3), pay('롯데카드', 0), '변동비', '취소·환불은 금액을 음수로 입력'],
    [day(5), '약국', 12800, cat('의료', 4), pay('신한체크카드', 2), '변동비', ''],
    [day(6), '휴대폰 요금', 55000, cat('통신비', 5), pay('기타결제', 5), '고정비', '자동이체'],
    [day(7), '아파트 관리비', 187000, cat('관리비', 6), pay('기타결제', 5), '고정비', '자동이체']
  ]
}

/** 샘플 양식 워크북을 만들어 바이트 배열로 반환한다. */
export async function buildSampleWorkbook(opts: SampleTemplateOptions = {}): Promise<Uint8Array> {
  const XLSX = await import('xlsx')
  const aoa: (string | number)[][] = [[...SAMPLE_HEADERS], ...buildSampleRows(opts)]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 28 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, SAMPLE_SHEET_NAME)
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array
}

/** 샘플 양식(.xlsx)을 브라우저에서 내려받는다. (클라이언트 전용) */
export async function downloadSampleTemplate(opts: SampleTemplateOptions = {}): Promise<void> {
  const bytes = await buildSampleWorkbook(opts)
  downloadBytes(bytes, opts.fileName || SAMPLE_FILE_NAME, XLSX_MIME)
}
