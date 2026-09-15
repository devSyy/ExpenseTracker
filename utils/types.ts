// 공용 타입 정의
//
// 카테고리/결제수단은 사용자가 settings 페이지에서 자유롭게 추가·수정·삭제할 수 있으므로
// 정적 union 대신 `string`으로 완화한다. 아래 DEFAULT_* 상수는 처음 실행 시에만
// 초기값으로 사용되며, 이후에는 useTaxonomies()의 reactive 목록이 진실의 원천(SoT)이다.

/** 결제수단 (기본 7종) — 사용자가 자유롭게 변경 가능 */
export type PaymentMethod = string

export const DEFAULT_PAYMENT_METHODS = [
  '롯데카드',
  '삼성카드',
  '지역화폐',
  '신한체크카드',
  '토스공유카드1',
  '토스공유카드2',
  '기타결제'
] as const

/** 지출 카테고리 — 사용자가 자유롭게 변경 가능 */
export type Category = string

export const DEFAULT_CATEGORIES = [
  '식비',
  '마트',
  '전통시장',
  '공과금',
  '전기요금',
  '관리비',
  '가스요금',
  '통신비',
  '대출이자',
  '교통',
  '의료',
  '교육',
  '문화/여가',
  '의류/미용',
  '경조사',
  '주거',
  '입출금',
  '기타'
] as const

/** 고정비 / 변동비 */
export type CostType = '고정비' | '변동비'

/**
 * 거래 유형 — 카테고리가 수입/지출 중 어디에 속하는지.
 * 카테고리 관리 화면에서 설정하며, 거래는 자기 카테고리의 유형을 따른다.
 */
export type TxType = '수입' | '지출'

/**
 * 결제 취소/환불 거래에 자동 부여되는 카테고리 이름.
 * 카테고리 관리 목록에 없으면 리포지토리가 자동으로 만들어 준다(필수 카테고리).
 */
export const REFUND_CATEGORY = '환불'

/** 유형이 지정되지 않은 카테고리의 기본값 (구버전 데이터 호환 — 기존 동작 유지) */
export const DEFAULT_TX_TYPE: TxType = '지출'

/** 신규 설치 시 기본 제공되는 수입 카테고리 */
export const DEFAULT_INCOME_CATEGORIES = [
  '급여',
  '보너스',
  '용돈',
  '이자',
  '환급',
  '판매수입',
  '기타수입'
] as const

/** 기본적으로 고정비로 처리되는 카테고리 (초기값) */
export const DEFAULT_FIXED_CATEGORIES = [
  '공과금',
  '전기요금',
  '관리비',
  '가스요금',
  '통신비',
  '대출이자',
  '주거'
] as const

/** 카테고리 정의 — 이름 + 수입/지출 유형 + 고정비 여부 + 표시 여부 */
export interface CategoryDef {
  name: string
  isFixed: boolean
  hidden?: boolean
  /**
   * 수입/지출 구분. 값이 없으면(구버전 저장 데이터) '지출'로 간주한다.
   * 리포지토리 로드 시 항상 채워지므로 런타임에서는 사실상 필수다.
   */
  type?: TxType
}

/** 결제수단 정의 — 이름 + 표시 여부 */
export interface PaymentDef {
  name: string
  hidden?: boolean
}

// ── 하위 호환 alias ──
// 기존 코드(특히 utils/classify.ts)가 CATEGORIES / PAYMENT_METHODS / FIXED_CATEGORIES를 import 한다.
// 분류 로직은 "초기 분류"용이므로 기본값을 그대로 사용해도 무방하다.
export const CATEGORIES: readonly string[] = DEFAULT_CATEGORIES
export const PAYMENT_METHODS: readonly string[] = DEFAULT_PAYMENT_METHODS
export const FIXED_CATEGORIES: readonly string[] = DEFAULT_FIXED_CATEGORIES

/** 집계 기간 구분 */
export type PeriodKind = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly'

/** 표준화된 단일 거래 */
export interface Transaction {
  id: string
  date: Date
  description: string
  amount: number                  // 양수 = 지출
  category: Category
  paymentMethod: PaymentMethod
  costType: CostType
  note?: string
  /** 가족 멤버 ID — 활성 멤버 필터/합산에 사용. 비어있으면 primary 소속으로 간주. */
  memberId?: string
  /**
   * 지출 계산 제외 플래그.
   * true면 KPI·차트·집계 등 모든 지출 계산에서 이 거래의 금액을 빼지만,
   * 거래 자체는 그대로 저장되고 거래 목록에도 계속 보인다.
   * 값이 없으면(구버전 데이터 포함) false = 제외 안 함.
   */
  excluded?: boolean
  /**
   * 원본 금액이 **음수**였는지 (사실 그대로의 기록).
   * -12,000 / (12,000) / 12,000- / △12,000 등이 모두 해당한다.
   * amount에는 크기(절대값)를 보관하므로 원본 금액은 -amount로 복원할 수 있다.
   * 음수 금액은 "쓴 돈"이 아니므로 환불로 분류되지 않더라도 지출 합계에는 넣지 않는다.
   * 값이 없으면(구버전 데이터 포함) false = 양수 거래.
   */
  negativeAmount?: boolean
  /**
   * **환불로 분류된 거래**인지.
   * 음수라고 무조건 true가 아니다 — 유형이 지출이고, 같은 금액의 양수 지출 거래가
   * 짝으로 존재할 때만 true가 되며 그때 카테고리가 REFUND_CATEGORY('환불')로 바뀐다.
   * 짝을 찾지 못한 음수 지출은 원래 카테고리를 그대로 유지한다(refund=false).
   */
  refund?: boolean
  /**
   * **수입/지출 관리에서 수기 입력한 항목을 대시보드로 미러링한 거래**일 때, 그 원본 항목의 id.
   * 이 값이 있는 거래는 대시보드가 소유한 것이 아니라 useIncomeExpense가 동기화하는 거래다
   * (원본이 수정·삭제되면 함께 갱신된다). 값이 없으면 대시보드 고유 거래.
   */
  ieSourceId?: string
  // 사전 계산된 파생 필드 (필터/그룹용)
  year: number                    // 2026
  month: number                   // 1..12
  quarter: number                 // 1..4
  half: 1 | 2                     // 상반기(1) / 하반기(2)
  weekLabel: string               // 2026-W17
  monthLabel: string              // 2026-04
  quarterLabel: string            // 2026-Q2
  halfLabel: string               // 2026-H1
  yearLabel: string               // 2026
}

/** 파일 파싱 결과 */
export interface ParseResult {
  transactions: Transaction[]
  warnings: string[]
  detectedColumns: Record<string, string>
  totalRows: number

  // ── 진단 정보 (선택) ──
  // 업로드가 실패했을 때 "왜 인식하지 못했는지"를 사용자에게 보여주기 위한 필드들.
  /** 실제로 사용한 시트 이름 */
  sheetName?: string
  /** 워크북의 전체 시트 목록 */
  sheetNames?: string[]
  /** 헤더로 인식한 행 번호 (1-based) */
  headerRow?: number
  /** 헤더 행의 원본 셀 값 */
  headers?: string[]
  /** 텍스트 파일일 때 사용한 인코딩 */
  encoding?: string
  /** 건너뛴 행 수 */
  skipped?: { noDate: number; noAmount: number; blank: number }
  /** 환불로 분류한 건수 (짝이 맞은 음수 지출) */
  refundCount?: number
  /** 음수지만 짝이 없어 환불로 분류하지 않은 건수 */
  unmatchedNegativeCount?: number
}
