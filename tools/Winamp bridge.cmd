@echo off
rem Double-click to start the Winamp bridge for the Tonelab app. Keep this window open during the gig.
title Winamp bridge for Tonelab
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0winamp-bridge.ps1"
pause
