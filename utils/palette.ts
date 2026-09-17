// 차트용 색상 팔레트.
//
// 실제 값과 배정 규칙은 utils/chartTheme.ts가 단일 진실의 원천(SoT)이다.
// 이 파일은 기존 import 경로를 유지하기 위한 얇은 재수출 레이어다.
//
// 왜 옮겼는가: 예전 팔레트는 17색을 인덱스로 돌려쓰는 방식이라
//  (1) 색이 카테고리가 아니라 **순위**에 붙어 필터를 바꾸면 같은 카테고리의 색이 달라졌고,
//  (2) 8색을 넘어가면 색약 조건에서 서로 구분되지 않는 색이 섞였다.
// chartTheme.ts의 8슬롯 팔레트는 색약·대비 검증을 통과한 고정 순서이며,
// 8개를 넘는 항목은 새 색을 만들지 않고 '기타'로 묶어 중립 회색을 쓴다.
import {
  CATEGORICAL,
  FIXED_COLOR,
  OTHER_COLOR,
  VARIABLE_COLOR,
  categoryColors
} from './chartTheme'

/** 검증된 카테고리 8슬롯 (고정 순서) */
export const PALETTE: readonly string[] = CATEGORICAL

/**
 * n개의 색을 돌려준다.
 *
 * @deprecated 색을 **항목 이름**에 고정하려면 `categoryColors(labels, { order })`를 쓸 것.
 * 이 함수는 순서만 보고 배정하므로 순위가 바뀌면 색도 바뀐다.
 * 8개를 넘는 만큼은 중립 회색으로 채운다(새 색을 만들지 않는다).
 */
export function pickColors(n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(i < CATEGORICAL.length ? CATEGORICAL[i] : OTHER_COLOR)
  return out
}

export { FIXED_COLOR, VARIABLE_COLOR, OTHER_COLOR, categoryColors }
