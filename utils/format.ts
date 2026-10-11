// 포매팅 유틸

const krw = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0
})

const krwCompact = new Intl.NumberFormat('ko-KR', {
  notation: 'compact',
  maximumFractionDigits: 1
})

export function formatKRW(value: number): string {
  if (!Number.isFinite(value)) return '₩0'
  return krw.format(Math.round(value))
}

export function formatKRWCompact(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return '₩' + krwCompact.format(Math.round(value))
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ko-KR').format(Math.round(value))
}

export function formatDate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function formatPercent(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '0%'
  return `${n.toFixed(digits)}%`
}

/** 로컬 타임존 기준 오늘 'YYYY-MM-DD' (toISOString은 UTC라 KST에서 하루 밀림) */
export function todayYmd(): string {
  return formatDate(new Date())
}

/** 천 단위 구분 숫자 (통화 기호 없음). 유한하지 않으면 '0'. round=true면 반올림 후 포맷 */
export function formatGrouped(value: number, round = false): string {
  if (!Number.isFinite(value)) return '0'
  return Number(round ? Math.round(value) : value).toLocaleString('ko-KR')
}

const KO_DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
const KO_SMALL_UNITS = ['', '십', '백', '천']
const KO_BIG_UNITS = ['', '만', '억', '조', '경']

/**
 * 금액을 한글 표기로 바꾼다. 1,250,000 → "일백이십오만 원", 0 → "영 원".
 * 금융 문서 관례대로 십·백·천 앞의 '일'도 적는다(일십, 일백, 일천).
 * 음수는 "마이너스"를 붙이고, 소수는 반올림한다. 숫자가 아니면 빈 문자열.
 * 안전 정수 범위를 넘는 값은 정밀도를 보장할 수 없으므로 빈 문자열.
 */
export function formatKoreanAmount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) return ''
  if (n === 0) return '영 원'
  const neg = n < 0
  let rest = Math.abs(n)
  const groups: string[] = []
  for (let g = 0; rest > 0; g++) {
    const part = rest % 10000
    rest = Math.floor(rest / 10000)
    if (part === 0) continue
    let s = ''
    for (let i = 3; i >= 0; i--) {
      const d = Math.floor(part / 10 ** i) % 10
      if (d) s += KO_DIGITS[d] + KO_SMALL_UNITS[i]
    }
    groups.unshift(s + KO_BIG_UNITS[g])
  }
  return `${neg ? '마이너스 ' : ''}${groups.join('')} 원`
}
