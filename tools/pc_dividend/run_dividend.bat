@echo off
rem DJ dividend bot - PC collector (TIGER, RISE)
rem Mirae Asset and KB block overseas servers (GitHub, Google), so this PC (Korean IP) fetches those two issuers.
rem Setup guide: tools/pc_dividend/설치안내.md  (ASCII only below, so cmd parses it safely)
set "DJ_DIR=%USERPROFILE%\dj_dividend"
set "LOG=%DJ_DIR%\log.txt"
if not exist "%DJ_DIR%\config.bat" (
  echo [%date% %time%] config.bat not found - see setup guide step 2 >> "%LOG%"
  exit /b 1
)
call "%DJ_DIR%\config.bat"
set SCRAPER_MODE=local
set PYTHONIOENCODING=utf-8

rem Always run the latest scraper.py from main
curl -fsSL -o "%DJ_DIR%\scraper.py.new" https://raw.githubusercontent.com/djseok/DJ_ETF_Study/main/scraper.py
if errorlevel 1 (
  echo [%date% %time%] download failed - running previous scraper.py >> "%LOG%"
) else (
  move /y "%DJ_DIR%\scraper.py.new" "%DJ_DIR%\scraper.py" > nul
)

echo ===== [%date% %time%] start ===== >> "%LOG%"
python -u "%DJ_DIR%\scraper.py" >> "%LOG%" 2>&1
echo ===== [%date% %time%] end (exit %errorlevel%) ===== >> "%LOG%"
