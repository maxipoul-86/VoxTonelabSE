# Winamp bridge for the Tonelab SE Tone Assistant.
#
# Watches classic Winamp 5.x every 50 ms through its documented window-message interface (IPC)
# and tells the app what is playing, on http://127.0.0.1:8737 (this computer only):
#   GET /events       Server-Sent Events: the current track at once, then every change (~50 ms)
#   GET /now-playing  the current track as JSON (fallback and testing)
# It never opens MIDI: the app in Chrome keeps the pedal connection.
#
# Start it with "Winamp bridge.cmd" next to this file and keep its window open during the gig.

param([int]$Port = 8737)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WinampState {
    public bool Running;
    public int State;   // 1 playing, 3 paused, 0 stopped
    public int Index;
    public string Title = "";
    public string File = "";
}

public static class WinampIpc {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr proc, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    const uint WM_USER = 0x400;
    const uint PROCESS_VM_READ = 0x10;
    const int IPC_ISPLAYING = 104;
    const int IPC_GETLISTPOS = 125;
    const int IPC_GETPLAYLISTTITLEW = 213;
    const int IPC_GETPLAYLISTFILEW = 214;

    static IntPtr Call(IntPtr w, int data, int id) {
        return SendMessage(w, WM_USER, new IntPtr(data), new IntPtr(id));
    }

    // The title and file calls return pointers inside Winamp's own memory.
    static string ReadWide(IntPtr proc, IntPtr addr) {
        if (addr == IntPtr.Zero) return "";
        var sb = new StringBuilder();
        var buf = new byte[256];
        long at = addr.ToInt64();
        for (int chunk = 0; chunk < 16; chunk++) {
            IntPtr read;
            if (!ReadProcessMemory(proc, new IntPtr(at), buf, new IntPtr(buf.Length), out read) || read.ToInt64() < 2) break;
            int n = (int)read.ToInt64() & ~1;
            for (int i = 0; i < n; i += 2) {
                char c = (char)(buf[i] | (buf[i + 1] << 8));
                if (c == '\0') return sb.ToString();
                sb.Append(c);
            }
            at += n;
        }
        return sb.ToString();
    }

    public static WinampState Read() {
        var s = new WinampState();
        IntPtr w = FindWindow("Winamp v1.x", null);
        if (w == IntPtr.Zero) return s;
        s.Running = true;
        s.State = (int)Call(w, 0, IPC_ISPLAYING).ToInt64();
        s.Index = (int)Call(w, 0, IPC_GETLISTPOS).ToInt64();
        uint pid;
        GetWindowThreadProcessId(w, out pid);
        IntPtr proc = OpenProcess(PROCESS_VM_READ, false, pid);
        if (proc == IntPtr.Zero) return s;
        try {
            s.Title = ReadWide(proc, Call(w, s.Index, IPC_GETPLAYLISTTITLEW));
            s.File = ReadWide(proc, Call(w, s.Index, IPC_GETPLAYLISTFILEW));
        } finally {
            CloseHandle(proc);
        }
        return s;
    }
}
'@

function Get-Snapshot {
  $w = [WinampIpc]::Read()
  $state = switch ($w.State) { 1 { 'playing' } 3 { 'paused' } default { 'stopped' } }
  [ordered]@{
    winamp    = $(if ($w.Running) { 'running' } else { 'not-running' })
    state     = $state
    index     = $w.Index
    title     = $w.Title
    file      = $w.File
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
  Write-Host "Port $Port is already in use. Is the bridge already running in another window?" -ForegroundColor Red
  exit 1
}

$streams = New-Object System.Collections.ArrayList
$snapshot = Get-Snapshot
$lastKey = ''
$lastPing = [DateTime]::UtcNow
$lastLine = ''
Write-Host "Winamp bridge on http://127.0.0.1:$Port - keep this window open. Press Ctrl+C to stop."

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

    # Winamp changes are pushed to every connected app at once.
    $now = Get-Snapshot
    $key = "$($now.winamp)|$($now.state)|$($now.index)|$($now.title)"
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

    $what = if ($snapshot.winamp -ne 'running') { 'Winamp not running' } elseif ($snapshot.title) { "Winamp: $($snapshot.state) '$($snapshot.title)'" } else { "Winamp: $($snapshot.state)" }
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
