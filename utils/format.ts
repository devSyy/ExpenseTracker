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
