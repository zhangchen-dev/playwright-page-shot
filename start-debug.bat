@echo off
set ELECTRON_ENABLE_LOGGING=1
cd /d D:\code_prj\playwright-page-shot
call node_modules\.bin\electron.cmd . --remote-debugging-port=9222 --remote-allow-origins=* 2>&1
