# The web server shared by the player bridges (winamp-bridge.ps1, media-bridge.ps1).
#
# Serves what the player is playing on http://127.0.0.1:<port> (this computer only):
#   GET /events       Server-Sent Events: the current track at once, then every change (~50 ms)
#   GET /now-playing  the current track as JSON (fallback and testing)
# It never opens MIDI: the app in Chrome keeps the pedal connection.

# $Read returns @{ running; state ('playing' | 'paused' | 'stopped'); index; title; artist; file }.
function Start-Bridge([int]$Port, [string]$Player, [scriptblock]$Read) {
  function Get-Snapshot {
    $r = & $Read
    [ordered]@{
      player    = $Player
      running   = [bool]$r.running
      state     = $r.state
      index     = [int]$r.index
      title     = [string]$r.title
      artist    = [string]$r.artist
      file      = [string]$r.file
      changedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
  }

  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $cors = "Access-Control-Allow-Origin: *`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Allow-Methods: GET, OPTIONS`r`nAccess-Control-Allow-Headers: *`r`nCache-Control: no-store`r`n"

  function Send-Text($stream, [string]$text) {
    $bytes = $utf8.GetBytes($text)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  }

  function Send-Response($client, [string]$status, [string]$type, [string]$body) {
    $len = $utf8.GetByteCount($body)
    Send-Text $client.GetStream() ("HTTP/1.1 $status`r`n$cors" + "Content-Type: $type`r`nContent-Length: $len`r`nConnection: close`r`n`r`n$body")
    $client.Close()
  }

  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
  try {
    $listener.Start()
  } catch {
    Write-Host "Port $Port is already in use. Is a bridge (Winamp or Spotify) already running in another window?" -ForegroundColor Red
    exit 1
  }

  $streams = New-Object System.Collections.ArrayList
  $snapshot = Get-Snapshot
  $lastKey = ''
  $lastPing = [DateTime]::UtcNow
  $lastLine = ''
  Write-Host "$Player bridge on http://127.0.0.1:$Port - keep this window open. Press Ctrl+C to stop."

  try {
    while ($true) {
      # New requests from the app.
      while ($listener.Pending()) {
        $client = $listener.AcceptTcpClient()
        try {
          $client.ReceiveTimeout = 1000
          $reader = New-Object System.IO.StreamReader($client.GetStream(), $utf8, $false, 1024, $true)
          $first = $reader.ReadLine()
          while (($line = $reader.ReadLine()) -ne $null -and $line -ne '') { }
          $method, $path = ($first -split ' ')[0, 1]
          $path = ($path -split '\?')[0]
          if ($method -eq 'OPTIONS') {
            Send-Response $client '204 No Content' 'text/plain' ''
          } elseif ($method -eq 'GET' -and $path -eq '/now-playing') {
            Send-Response $client '200 OK' 'application/json; charset=utf-8' ($snapshot | ConvertTo-Json -Compress)
          } elseif ($method -eq 'GET' -and $path -eq '/events') {
            $stream = $client.GetStream()
            Send-Text $stream ("HTTP/1.1 200 OK`r`n$cors" + "Content-Type: text/event-stream; charset=utf-8`r`nConnection: keep-alive`r`n`r`nretry: 1000`n`ndata: " + ($snapshot | ConvertTo-Json -Compress) + "`n`n")
            [void]$streams.Add($client)
          } else {
            Send-Response $client '404 Not Found' 'text/plain' 'Not found'
          }
        } catch {
          $client.Close()
        }
      }

      # Player changes are pushed to every connected app at once.
      # A player closing mid-read keeps the last snapshot for one more round.
      try { $now = Get-Snapshot } catch { $now = $snapshot }
      $key = "$($now.running)|$($now.state)|$($now.index)|$($now.artist)|$($now.title)"
      $message = $null
      if ($key -ne $lastKey) {
        $lastKey = $key
        $snapshot = $now
        $message = 'data: ' + ($snapshot | ConvertTo-Json -Compress) + "`n`n"
      } elseif (([DateTime]::UtcNow - $lastPing).TotalSeconds -ge 15) {
        $message = ": ping`n`n"
      }
      if ($message) {
        $lastPing = [DateTime]::UtcNow
        foreach ($c in @($streams)) {
          try { Send-Text $c.GetStream() $message } catch { $c.Close(); $streams.Remove($c) }
        }
      }

      $song = (@($snapshot.artist, $snapshot.title) | Where-Object { $_ }) -join ' - '
      $what = if (-not $snapshot.running) { "$Player not running" } elseif ($song) { "${Player}: $($snapshot.state) '$song'" } else { "${Player}: $($snapshot.state)" }
      $status = "Bridge on 127.0.0.1:$Port | $($streams.Count) app(s) connected | $what"
      if ($status -ne $lastLine) {
        $lastLine = $status
        $Host.UI.RawUI.WindowTitle = $status
        Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $status)
      }

      Start-Sleep -Milliseconds 50
    }
  } finally {
    foreach ($c in @($streams)) { $c.Close() }
    $listener.Stop()
  }
}
