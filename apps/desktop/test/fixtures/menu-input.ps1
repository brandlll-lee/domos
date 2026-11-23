param([long]$Window, [string]$Points, [switch]$Click)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MenuInput {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int x; public int y; }
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@
[void][MenuInput]::SetThreadDpiAwarenessContext([IntPtr](-4))
$handle = [IntPtr]$Window
[void][MenuInput]::SetForegroundWindow($handle)
$origin = New-Object MenuInput+Point
[void][MenuInput]::ClientToScreen($handle, [ref]$origin)
$results = @()
foreach ($point in ($Points | ConvertFrom-Json)) {
  $x = $origin.x + [int]$point.x
  $y = $origin.y + [int]$point.y
  $packed = (($y -band 0xffff) -shl 16) -bor ($x -band 0xffff)
  $hit = [MenuInput]::SendMessage($handle, 0x84, [IntPtr]::Zero, [IntPtr]$packed).ToInt32()
  $results += @{ hit = $hit; x = $x; y = $y }
}
$target = $results[0]
[void][MenuInput]::SetCursorPos($origin.x + 8, $origin.y + 8)
Start-Sleep -Milliseconds 30
[void][MenuInput]::SetCursorPos($target.x, $target.y)
if ($Click) {
  [MenuInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [MenuInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
}
ConvertTo-Json -InputObject @($results)
