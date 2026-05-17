# 가계부 대시보드 · Household Expense Tracker

Nuxt 3 + Vue 3 + TypeScript 기반의 **가계 지출 분석 대시보드**입니다.
엑셀 파일 한 개만 업로드하면 브라우저 안에서 바로 다음과 같은 분석을 수행합니다.

- **기간별 분류** — 주간 · 월별 · 분기별 · 반기별 · 연도별 추이
- **비용 구분** — 고정비 / 변동비 자동 분리 및 비중 시각화
- **결제수단별 분석** — 롯데카드 / 삼성카드 / 지역화폐 / 신한체크카드 / 토스공유카드1 / 토스공유카드2
- **카테고리 분석** — 식비 · 마트 · 전통시장 · 공과금(전기/관리비/가스) · 통신비 · 대출이자 · 교통 외 다수
- **그래프** — 누적 막대, 도넛, 가로 막대, 월별×카테고리 스택 차트

> ℹ️ 업로드한 파일은 **서버로 전송되지 않으며** 모두 브라우저 안에서만 처리됩니다.

---

## 요구사항

- **Node.js 20.x** (v20.9.0 포함) 또는 그 이상 — Node 업그레이드 필요 없음
- 다른 Vue/Nuxt 프로젝트와 동일한 Node 버전을 그대로 사용하도록, `package.json` 에서
  - `nuxt: 3.11.2` — `nuxi` 가 `node:util.styleText` (Node 20.12+ 전용 API) 를 쓰기 전 버전
  - `vue: 3.4.27` / `vue-router: 4.3.2` — 위 Nuxt 와 호환되는 쌍
  - `overrides` 로 `nuxi`, `@clack/core`, `@clack/prompts`, `consola` 도 각각 구버전 고정

## 빠른 시작

```bash
# 이전 설치물이 있으면 먼저 정리
# Windows PowerShell:
Remove-Item -Recurse -Force node_modules, package-lock.json
# macOS / Linux:
# rm -rf node_modules package-lock.json

npm install
npm run dev      # http://localhost:3000
```

빌드 / 정적 배포는 다음과 같습니다.

```bash
npm run build
npm run generate   # 순수 정적 사이트로 빌드
```

---

## 엑셀 파일 형식

`public/sample-template.xlsx` 을 참고해 주세요. 권장 열 구성은 다음과 같습니다.

| 열 이름 | 필수 | 설명 |
|----------|:---:|------|
| 날짜 | ✅ | 2026-04-23 형식을 권장합니다. `YYYY/MM/DD`, `YYYY.MM.DD` 도 인식합니다. |
| 금액 | ✅ | 숫자 또는 `15,900`, `₩15,900` 과 같은 문자열도 허용합니다. |
| 내용 | ◯ | 가맹점/적요. 검색에 사용됩니다. |
| 카테고리 | ◯ | 식비·마트·통신비 등. 비워두면 내용 기반으로 자동 분류합니다. |
| 결제수단 | ◯ | 롯데카드 / 삼성카드 / 지역화폐 / 신한체크카드 / 토스공유카드1 / 토스공유카드2 |
| 구분 | ◯ | `고정비` 또는 `변동비`. 비워두면 카테고리 기반으로 자동 지정합니다. |
| 비고 | ◯ | 참고용 메모. |

**헤더 자동 인식**: 한/영 혼용도 허용합니다. 예를 들어 `date`, `amount`, `category`, `payment`, `memo` 같은 영어 헤더도 그대로 인식합니다.

### 카테고리 자동 분류

카테고리 열이 비어 있거나 사용자 정의 값인 경우, `유틸/classify.ts` 의 규칙 기반 매핑으로 다음과 같이 정규화됩니다.

- 식비 · 마트 · 전통시장
- 공과금 · 전기요금 · 관리비 · 가스요금
- 통신비 · 대출이자 · 주거
- 교통 · 의료 · 교육 · 문화/여가 · 의류/미용 · 경조사 · 기타

### 고정비 판정 기준 (기본값)

다음 카테고리는 명시적 구분이 없어도 **고정비** 로 분류됩니다.

> 관리비 · 전기요금 · 가스요금 · 공과금 · 통신비 · 대출이자 · 주거

필요 시 엑셀의 "구분" 열에 `고정비` / `변동비` 를 직접 지정하면 최우선으로 반영됩니다.

---

## 프로젝트 구조

```
ExpenseTracker/
├─ app.vue                    헤더/푸터 포함한 루트 레이아웃
├─ pages/index.vue            대시보드 페이지
├─ components/
│  ├─ UploadCard.vue          파일 업로드 & 샘플 불러오기
│  ├─ FiltersBar.vue          연도/카테고리/결제수단/구분 필터
│  ├─ KPICards.vue            총지출·월평균·고정·변동 요약
│  ├─ TransactionsTable.vue   거래 테이블
│  ├─ CategoryLeaderboard.vue 카테고리 TOP 10
│  └─ charts/
│     ├─ PeriodTrendChart.vue      주·월·분기·반기·연도 전환 가능한 누적막대
│     ├─ CategoryDonut.vue         카테고리별 지출 도넛
│     ├─ PaymentBar.vue            결제수단별 가로막대
│     ├─ FixedVariableDonut.vue    고정/변동 도넛
│     └─ CategoryStack.vue         월별×카테고리 스택
├─ composables/useExpenses.ts 필터/상태 전역 공유
├─ utils/
│  ├─ parseExcel.ts           SheetJS 기반 파일 파싱
│  ├─ classify.ts             컬럼 감지 & 카테고리/결제수단/구분 정규화
│  ├─ aggregate.ts            기간·카테고리·결제수단 집계
│  ├─ format.ts               KRW/날짜 포맷터
│  ├─ palette.ts              차트 색상
│  └─ types.ts                공용 타입
├─ plugins/chartjs.client.ts  Chart.js 전역 등록
├─ public/
│  ├─ sample-expenses.csv     데모용 2024–2026 샘플 데이터
│  └─ sample-template.xlsx    사용자 작성용 엑셀 템플릿
└─ nuxt.config.ts / tailwind.config.js / ...
```

---

## 기술 스택

- **Nuxt 3** (SPA 모드) · **Vue 3** · **TypeScript**
- **Tailwind CSS** (Pretendard 웹폰트)
- **Chart.js** + **vue-chartjs**
- **SheetJS (xlsx)** — 브라우저에서 .xlsx / .xls / .csv 파싱

---

## 라이선스

개인 사용 목적의 예시 프로젝트입니다. 필요에 맞게 자유롭게 수정해 주세요.
