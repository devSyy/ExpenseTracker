@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo  ExpenseTracker - 커밋 ^& 배포
echo ============================================
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [오류] git 저장소가 아닙니다. 이 파일이 프로젝트 루트에 있는지 확인하세요.
  goto :end
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
echo 현재 브랜치: %BRANCH%
if /i not "%BRANCH%"=="master" (
  echo.
  echo [경고] 배포는 master 브랜치 push에서만 동작합니다 ^(.github/workflows/deploy.yml^)
  echo        지금 브랜치는 %BRANCH% 입니다.
  set /p cont="그래도 계속할까요? (y/N) "
  if /i not "!cont!"=="y" goto :abort
)

echo.
echo [1/4] 변경 파일 스테이징... ^(소스 23개만 — 스크린샷/빌드 산출물은 제외^)

REM ── utils (3) ──
git add utils/types.ts
git add utils/classify.ts
git add utils/parseExcel.ts

REM ── composables (5) ──
git add composables/useFamily.ts
git add composables/useExpenses.ts
git add composables/useTaxonomies.ts
git add composables/useIncomeExpense.ts
git add composables/useMemberUploads.ts

REM ── repositories (4) ──
git add repositories/index.ts
git add repositories/familyRepository.ts
git add repositories/taxonomiesRepository.ts
git add repositories/transactionsRepository.ts

REM ── components (7) ──
git add components/UploadCard.vue
git add components/ExcelUploader.vue
git add components/ExcelPreview.vue
git add components/MemberUploadPanel.vue
git add components/TransactionsTable.vue
git add components/KPICards.vue
git add components/FiltersBar.vue

REM ── layouts / pages (4) ──
git add layouts/default.vue
git add pages/index.vue
git add pages/settings.vue
git add pages/income-expense.vue

echo.
echo [2/4] 스테이징 결과 ^(이 파일들만 커밋됩니다^)
echo --------------------------------------------
git status --short
echo --------------------------------------------
echo.

set /p ok="이대로 커밋하고 %BRANCH% 에 푸시할까요? (y/N) "
if /i not "%ok%"=="y" goto :abort

echo.
echo [3/4] 커밋...
git commit ^
 -m "feat: 엑셀 업로드/분류/집계 개선 및 가족별 독립 가계부" ^
 -m "업로드/파싱" ^
 -m "- 헤더 행 자동 탐지(제목행이 앞에 있는 카드사/은행 파일 대응)" ^
 -m "- EUC-KR(CP949)/BOM 없는 UTF-8/UTF-16 인코딩 자동 판별" ^
 -m "- 다중 시트 중 거래가 가장 많은 시트 선택, HTML로 위장한 .xls 지원" ^
 -m "- 날짜/금액 관용 파싱: '2026년 3월 2일', '2026. 1. 5', 20260305, 전각 숫자" ^
 -m "- 실패 시 인식한 헤더/시트/인코딩/건너뛴 행을 사용자에게 노출" ^
 -m "" ^
 -m "가족" ^
 -m "- 가족 구성원별 독립 업로드 임시 상태 및 멤버 단위 저장(교체/추가)" ^
 -m "- 선택된 가족들의 데이터를 합산 조회, 멤버별 저장 데이터는 서로 독립" ^
 -m "" ^
 -m "분류/집계" ^
 -m "- 카테고리별 수입/지출 유형 설정, 거래는 카테고리 유형을 따름" ^
 -m "- 음수 금액을 환불로 분류하고 '환불' 카테고리 자동 배정(지출 합계 제외)" ^
 -m "- 거래별 '지출 계산 제외' 플래그(개별/현재 페이지 일괄)" ^
 -m "- 카테고리 변경 시 단건/관련 거래 일괄 범위를 사용자가 선택" ^
 -m "" ^
 -m "UI" ^
 -m "- 거래 내역 카드 고정 높이 + 내부 스크롤" ^
 -m "- 내용 컬럼 배지(수입/지출·환불·제외) 독립 표시, 긴 내용에서도 유지" ^
 -m "- 연/월 필터 기본값을 현재 연·월로 초기화(+ 해당 기간 데이터 없을 때 안내)" ^
 -m "" ^
 -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" ^
 -m "Claude-Session: https://claude.ai/code/session_012TEnzE2aD4H9sStR5TD9tH"
if errorlevel 1 (
  echo.
  echo [오류] 커밋 실패. 위 메시지를 확인하세요.
  goto :end
)

echo.
echo [4/4] 푸시... ^(자격 증명을 물어볼 수 있습니다^)
git push origin %BRANCH%
if errorlevel 1 (
  echo.
  echo [오류] 푸시 실패. 커밋은 로컬에 남아 있으니 인증 후 다시 실행하거나
  echo        git push origin %BRANCH% 를 직접 실행하세요.
  goto :end
)

echo.
echo ============================================
echo  완료. GitHub Actions 가 빌드/재시작합니다.
echo  배포 후 브라우저에서 Ctrl+Shift+R 로 강력 새로고침 하세요.
echo ============================================
goto :end

:abort
echo.
echo 취소했습니다. 스테이징을 되돌리려면: git reset

:end
echo.
pause
endlocal
