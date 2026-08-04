Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32API {
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);
}
'@
[int]$w = [Win32API]::GetSystemMetrics(0)
[int]$h = [Win32API]::GetSystemMetrics(1)
Write-Host "Resolution: $w x $h"
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size($w, $h)))
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$dir = "d:/code_prj/playwright-page-shot"
$outPath = Join-Path $dir ("screen_" + $ts + ".png")
Write-Host "Will save to: $outPath"
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$bmp.Dispose()
Write-Host "SAVED SUCCESS: $outPath"