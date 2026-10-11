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
  '카드대금',
  '내계좌이체',
  '기타'
] as const

/**
 * 기본으로 '지출제외'가 켜진 카테고리 — 돈이 내 계좌/카드 사이를 오갈 뿐 실제 소비가 아니다.
 * (실제 소비는 카드 사용내역·결제처 거래로 따로 잡힌다. 카드대금 출금까지 세면 이중집계)
 */
export const DEFAULT_EXCLUDED_CATEGORIES: readonly string[] = ['입출금', '카드대금', '내계좌이체', '이체', '계좌이체', '환불']

/** 위 목록에 이름이 없어도, 유형이 '이체'인 카테고리는 기본으로 지출제외를 켠다 (새로 만들거나 유형을 바꿀 때도 동일) */
export const DEFAULT_EXCLUDED_TYPES: readonly string[] = ['이체']

/** 고정비 / 변동비 */
export type CostType = '고정비' | '변동비'

/**
 * 거래 유형 — 카테고리가 수입/지출 중 어디에 속하는지.
 * 카테고리 관리 화면에서 설정하며, 거래는 자기 카테고리의 유형을 따른다.
 */
export type TxType = '수입' | '지출' | '이체' | '저축' | '충전'

/** '충전' 유형 — 페이/선불카드/포인트 등 충전. 이체처럼 수입·지출 어느 쪽 집계에도 들어가지 않는다 (실제 소비는 충전금을 쓸 때 잡힌다). */

/**
 * 계좌이체(내 통장 ↔ 내 통장) 전용 카테고리 이름. 유형은 '이체'.
 * '이체' 유형은 수입·지출 어느 쪽 집계에도 들어가지 않는다 — 돈이 내 계좌 사이를 옮겼을 뿐
 * 쓴 돈이 아니기 때문이다. 실제 소비는 옮겨간 통장(B)에서 일어나는 지출 거래로 잡힌다.
 * 카테고리 관리 목록에 없으면 리포지토리가 자동으로 만들어 준다(필수 카테고리).
 */
/**
 * '저축' 유형 — 저축/적금/투자로 옮긴 돈. 이체처럼 수입·지출 어느 쪽 집계에도 들어가지 않는다
 * (쓴 돈이 아니라 모은 돈이므로). 카테고리 관리에서 유형을 '저축'으로 지정한다.
 */
export const TRANSFER_CATEGORY = '계좌이체'

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
  /**
   * 지출 계산 제외 — 켜면 이 카테고리의 모든 거래가 지출 계산(KPI·차트·집계)에서 빠진다.
   * 거래 목록에는 그대로 남는다. 지출 유형 카테고리에만 적용된다. 값이 없으면 false.
   */
  excludeFromCalc?: boolean
}

/**
 * 결제수단 태그 — 이 결제수단으로 나간 돈의 성격.
 * '소비'는 실제로 쓴 돈, '저축'은 자산으로 옮긴 돈이다.
 *
 * 태그 자체는 수입/지출 집계 규칙을 바꾸지 않는다(집계는 여전히 카테고리 유형이 결정한다).
 * 태그가 하는 일은 **어느 카테고리 매핑을 적용할지** 고르는 것뿐이다.
 */
export type PaymentTag = '소비' | '저축'

export const PAYMENT_TAGS = ['소비', '저축'] as const

/** 태그가 지정되지 않은 결제수단의 기본값 (구버전 데이터 호환 — 기존 동작 유지) */
export const DEFAULT_PAYMENT_TAG: PaymentTag = '소비'

/** 결제수단 정의 — 이름 + 표시 여부 + 소비/저축 태그 + 태그별 카테고리 매핑 */
export interface PaymentDef {
  name: string
  hidden?: boolean
  /**
   * 소비/저축 태그. 값이 없으면(구버전 저장 데이터) '소비'로 간주한다.
   * 리포지토리 로드 시 항상 채워지므로 런타임에서는 사실상 필수다.
   */
  tag?: PaymentTag
  /**
   * **태그별 카테고리 매핑.** 이 결제수단이 선택되면 현재 태그에 매핑된 카테고리가
   * 거래에 자동 배정된다. 매핑이 없는 태그는 키 자체가 없으며, 그때는 자동 배정이
   * 일어나지 않는다(기존 동작 그대로).
   */
  categoryByTag?: Partial<Record<PaymentTag, string>>
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
   * '중복/환불 자동 제외'를 이미 적용한 거래인지.
   * 자동 체크는 거래당 한 번만 한다 — 사용자가 나중에 제외를 해제해도 다시 켜지지 않게 하는 마커.
   */
  autoExcludeApplied?: boolean
  /**
   * 중복/환불 자동 제외가 **수입 거래**에 적용되었는지.
   * 수입은 excluded가 항상 true라(지출 계산 제외 플래그와 무관) 그 플래그로는 수입 집계에서 뺄 수 없으므로
   * 별도 플래그로 수입 합계에서 뺀다. 수입 행의 체크박스는 해제할 수 없으므로 이 플래그도 자동으로만 켜진다.
   */
  autoExcludedIncome?: boolean
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
   * 환불 짝에 속한 **상대편 행**임을 나타내는 표시 — '환불' 배지만 붙이고 카테고리·집계는 건드리지 않는다.
   *  - 'origin' : 환불로 취소된 원래 결제 행 (같은 금액의 환불과 짝이 맞은 양수 지출)
   *  - 'deposit': 환불금이 들어온 입금 행 (내용에 환불·취소 표현이 있고 같은 금액의 지출과 짝이 맞은 양수 행)
   * 음수 환불 행 자신은 refund=true 로 표현하므로 이 값이 없다.
   */
  refundPair?: 'origin' | 'deposit'
  /**
   * 업로드 파일의 **타입 열이 '지출'인데 금액이 양수**인 행 — 환불금이 들어온 행이다. (뱅크샐러드류 내보내기는
   * 지출을 음수로 적으므로 양수 지출 = 환불.) 파서가 표시만 해 두고, 분류는 classifyRefunds 가 한다.
   */
  refundDeposit?: boolean
  /**
   * 업로드 파일의 '타입' 열 원본 값(수입/지출/이체). 새 카테고리를 처음 등록할 때 유형을 추정하는 데만 쓰인다.
   * 집계는 항상 카테고리 설정의 유형을 따르며 이 값을 직접 보지 않는다.
   */
  fileType?: '수입' | '지출' | '이체'
  /**
   * **수입/지출 관리에서 수기 입력한 항목을 대시보드로 미러링한 거래**일 때, 그 원본 항목의 id.
   * 이 값이 있는 거래는 대시보드가 소유한 것이 아니라 useIncomeExpense가 동기화하는 거래다
   * (원본이 수정·삭제되면 함께 갱신된다). 값이 없으면 대시보드 고유 거래.
   */
  ieSourceId?: string
  /**
   * **선불 자산(지역화폐 등) 사용 거래**인지. 카드 거래 원본은 그대로 두고 표시만 덧붙인다.
   * true면 이 거래는 카드 소비가 아니라 localCurrencyId 자산에서 쓴 돈으로 본다
   * (소비 통계에는 카테고리 그대로 **한 번만** 잡히고, 카드 실적·결제수단 집계에서는 빠지며, 자산 잔액이 차감된다).
   * 값이 없으면(구버전 데이터 포함) false.
   */
  localCurrencyUsed?: boolean
  /** localCurrencyUsed가 true일 때 사용한 선불 자산 id (예: 'SEOUL_PAY'). */
  localCurrencyId?: string
  /** 지역화폐 사용 체크가 '지출 제외'를 대신 켠 거래인지 — 체크 해제 시 이것만 원복한다 (원래부터 제외였던 거래는 건드리지 않는다). */
  localCurrencyExcluded?: boolean
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

/** 계약·기념일 등 단건 변경 결과 */
export interface MutationResult {
  ok: boolean
  id?: string
  reason?: string
}
