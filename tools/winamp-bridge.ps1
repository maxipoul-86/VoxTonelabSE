# Winamp bridge for the Tonelab SE Tone Assistant.
#
# Watches classic Winamp 5.x every 50 ms through its documented window-message interface (IPC)
# and tells the app what is playing, on http://127.0.0.1:8737 (this computer only, see bridge-server.ps1).
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

. (Join-Path $PSScriptRoot 'bridge-server.ps1')

Start-Bridge -Port $Port -Player 'Winamp' -Read {
  $w = [WinampIpc]::Read()
  @{
    running = $w.Running
    state   = switch ($w.State) { 1 { 'playing' } 3 { 'paused' } default { 'stopped' } }
    index   = $w.Index
    title   = $w.Title
    file    = $w.File
  }
}
