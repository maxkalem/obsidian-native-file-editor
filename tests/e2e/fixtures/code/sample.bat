@echo off
REM Batch
set COUNT=3
if %COUNT% GTR 2 (
  echo big %COUNT%
) else (
  echo small
)
goto :eof
