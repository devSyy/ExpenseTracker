@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM ============================================================
REM  ExpenseTracker - 소스 커밋 ^& 푸시
REM
REM  이 파일은 "소스를 GitHub 에 올리는" 용도입니다.
REM  사이트 배포는 gh-pages-deploy.bat 입니다 - 둘은 독립입니다.
REM
REM  예전에는 파일 목록을 하드코딩해서 add 했는데, 새 파일이 생길 때마다
REM  목록에서 누락돼 저장소가 빌드 불가 상태가 됐습니다. 이제 git add -A 로
REM  변경 전체를 올리고, 제외는 .gitignore 한 곳에서만 관리합니다.
REM ============================================================

echo ============================================
echo  ExpenseTracker - 소스 커밋 ^& 푸시
echo ============================================
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [오류] git 저장소가 아닙니다. 이 파일이 프로젝트 루트에 있는지 확인하세요.
  goto :end
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
echo 현재 브랜치: !BRANCH!
echo.

echo [1/4] 변경 전체 스테이징... ^(.gitignore 제외분은 빠집니다^)
git add -A
if errorlevel 1 (
  echo [오류] 스테이징 실패.
  goto :end
)

echo.
echo [2/4] 스테이징 결과
echo --------------------------------------------
git status --short
echo --------------------------------------------

git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo 커밋할 변경이 없습니다.
  goto :end
)

echo.
echo [3/4] 커밋 메시지를 입력하세요. ^(예: feat: 거래내역 고급 필터 추가^)
echo       비워 두고 Enter 를 누르면 취소합니다.
set "MSG="
set /p MSG="메시지: "
if "!MSG!"=="" goto :abort

echo.
echo   브랜치 : !BRANCH!
echo   메시지 : !MSG!
echo.
set "OK="
set /p OK="이대로 커밋하고 푸시할까요? (y/N) "
if /i not "!OK!"=="y" goto :abort

echo.
git commit -m "!MSG!"
if errorlevel 1 (
  echo.
  echo [오류] 커밋 실패. 위 메시지를 확인하세요.
  goto :end
)

echo.
echo [4/4] 푸시... ^(자격 증명을 물어볼 수 있습니다^)
git push origin !BRANCH!
if errorlevel 1 (
  echo.
  echo [오류] 푸시 실패. 커밋은 로컬에 남아 있습니다.
  echo        인증 후 다시 실행하거나 git push origin !BRANCH! 를 직접 실행하세요.
  goto :end
)

echo.
echo ============================================
echo  소스 푸시 완료.
echo.
echo  주의: 이것만으로는 사이트가 바뀌지 않습니다.
echo        GitHub Pages 에 반영하려면 gh-pages-deploy.bat 을 실행하세요.
echo ============================================
goto :end

:abort
echo.
echo 취소했습니다. 스테이징을 되돌리려면: git reset

:end
echo.
pause
endlocal
