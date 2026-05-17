// 차트용 색상 팔레트
export const PALETTE: string[] = [
  '#2f7bff', // brand blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
  '#84cc16', // lime
  '#eab308', // yellow
  '#a855f7', // purple
  '#10b981', // emerald
  '#64748b', // slate
  '#dc2626', // red-600
  '#0ea5e9'  // sky
]

export function pickColors(n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(PALETTE[i % PALETTE.length])
  return out
}

export const FIXED_COLOR = '#1a5eeb'
export const VARIABLE_COLOR = '#f59e0b'
