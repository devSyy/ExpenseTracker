@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

REM ============================================================
REM  ExpenseTracker - GitHub Pages 배포
REM
REM  https://devsyy.github.io/ExpenseTracker/ 로 나갑니다.
REM  git-deploy.bat 은 "소스 커밋/푸시"용이고, 이 파일은 "빌드/배포"용입니다.
REM  둘은 독립입니다 - 소스를 푸시해도 이 파일을 돌리기 전엔 사이트가 안 바뀝니다.
REM
REM  사전 설정 (최초 1회):
REM    GitHub - Settings - Pages - Source: Deploy from a branch
REM                                Branch: gh-pages / (root)
REM ============================================================

echo ============================================
echo  ExpenseTracker - GitHub Pages 배포
echo ============================================
echo.

REM Project Pages 는 저장소 이름이 경로에 붙는다. 이 값이 없으면 자산 경로가 전부 깨진다.
set NUXT_APP_BASE_URL=/ExpenseTracker/

REM 정적 출력 + .nojekyll + 404.html. nuxt.config 에 박지 않고 여기서만 주는 이유는
REM Docker 배포(npm run build)가 Node 서버 출력을 그대로 써야 하기 때문입니다.
set NITRO_PRESET=github-pages

echo base path : %NUXT_APP_BASE_URL%
echo preset    : %NITRO_PRESET%
echo.

echo [1/3] 정적 파일 생성... ^(nuxt generate^)
call npm run generate
if errorlevel 1 (
  echo.
  echo [오류] 빌드 실패. 위 메시지를 확인하세요.
  goto :end
)

if not exist ".output\public\index.html" (
  echo.
  echo [오류] .output\public\index.html 이 없습니다. generate 가 정상 동작했는지 확인하세요.
  goto :end
)

echo.
echo [2/3] 산출물 점검
if exist ".output\public\.nojekyll" (
  echo   .nojekyll      OK   ^(_nuxt 폴더가 Jekyll 에 먹히지 않습니다^)
) else (
  echo   .nojekyll      없음 [경고] nitro preset 이 github-pages 인지 확인하세요.
)
if exist ".output\public\404.html" (
  echo   404.html       OK   ^(딥링크 새로고침이 SPA 로 살아납니다^)
) else (
  echo   404.html       없음 [경고] 하위 경로 새로고침 시 404 가 납니다.
)
echo.

set /p ok="gh-pages 브랜치로 배포할까요? (y/N) "
if /i not "%ok%"=="y" goto :abort

echo.
echo [3/3] 배포... ^(gh-pages 브랜치에 push - 자격 증명을 물어볼 수 있습니다^)
call npm run deploy:pages
if errorlevel 1 (
  echo.
  echo [오류] 배포 실패. gh-pages 패키지가 설치돼 있는지 확인하세요: npm install
  goto :end
)

echo.
echo ============================================
echo  완료. 반영까지 1~2분 걸립니다.
echo  https://devsyy.github.io/ExpenseTracker/
echo  브라우저에서 Ctrl+Shift+R 로 강력 새로고침 하세요.
echo ============================================
goto :end

:abort
echo.
echo 취소했습니다.

:end
echo.
pause
endlocal
