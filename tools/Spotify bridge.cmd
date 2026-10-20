@echo off
rem Double-click to start the Spotify bridge for the Tonelab app. Keep this window open during the gig.
title Spotify bridge for Tonelab
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0media-bridge.ps1" -App Spotify
pause
