# Spotify bridge for the Tonelab SE Tone Assistant (works with other players too).
#
# Reads what Windows shows in its media pop-up (System Media Transport Controls, Windows 10 1809 or later)
# every 50 ms and tells the app what is playing, on http://127.0.0.1:8737 (this computer only, see bridge-server.ps1).
# Works with the Spotify desktop app, Free or Premium: nothing to sign in to.
#
# Start it with "Spotify bridge.cmd" next to this file and keep its window open during the gig.
# -App picks the player by its Windows app id (a regular expression): 'Spotify' (default), 'Chrome', ...

param([int]$Port = 8737, [string]$App = 'Spotify')

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]

# Windows answers asynchronously; PowerShell 5.1 waits on it as a .NET task.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
  Select-Object -First 1
function Wait-Result($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  [void]$task.Wait(-1)
  $task.Result
}

try {
  $manager = Wait-Result ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch {
  Write-Host "Windows media controls are not available here (Windows 10 version 1809 or later is needed)." -ForegroundColor Red
  exit 1
}

. (Join-Path $PSScriptRoot 'bridge-server.ps1')

Start-Bridge -Port $Port -Player $App -Read {
  $session = @($manager.GetSessions()) | Where-Object { $_.SourceAppUserModelId -match $App } | Select-Object -First 1
  if (-not $session) { return @{ running = $false; state = 'stopped' } }
  $props = Wait-Result ($session.TryGetMediaPropertiesAsync()) $propsType
  @{
    running = $true
    state   = switch ([int]$session.GetPlaybackInfo().PlaybackStatus) { 4 { 'playing' } 5 { 'paused' } default { 'stopped' } }
    title   = $props.Title
    artist  = $props.Artist
  }
}
