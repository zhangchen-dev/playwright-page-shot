Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# 获取桌面根元素
$root = [System.Windows.Automation.AutomationElement]::RootElement

# 查找标题为"场景录制助手"的窗口
$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    "场景录制助手")

$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)

Write-Host ("Found " + $windows.Count + " window(s)")

foreach ($win in $windows) {
    $rect = $win.Current.BoundingRectangle
    Write-Host ("=== Window: '" + $win.Current.Name + "' ===")
    Write-Host ("  ClassName: " + $win.Current.ClassName)
    Write-Host ("  ControlType: " + $win.Current.ControlType.ProgrammaticName)
    Write-Host ("  Bounds: X=" + $rect.X + ", Y=" + $rect.Y + ", W=" + $rect.Width + ", H=" + $rect.Height)
    Write-Host ("  IsEnabled: " + $win.Current.IsEnabled)
    Write-Host ("  IsOffscreen: " + $win.Current.IsOffscreen)
    Write-Host ""
    
    # 获取所有子元素（深度5层）
    function DumpChildren($element, $depth, $maxDepth) {
        if ($depth -gt $maxDepth) { return }
        $indent = "  " * $depth
        try {
            $children = $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
            foreach ($child in $children) {
                $name = $child.Current.Name
                $ct = $child.Current.ControlType.ProgrammaticName
                $cls = $child.Current.ClassName
                $autoId = $child.Current.AutomationId
                $r = $child.Current.BoundingRectangle
                $off = $child.Current.IsOffscreen
                $enabled = $child.Current.IsEnabled
                $info = "$indent[$ct]"
                if ($name) { $info += " Name='$name'" }
                if ($autoId) { $info += " AutoId='$autoId'" }
                if ($cls) { $info += " Class='$cls'" }
                $info += " Rect=($($r.X),$($r.Y),$($r.Width),$($r.Height))"
                if ($off) { $info += " [OFFSCREEN]" }
                if (-not $enabled) { $info += " [DISABLED]" }
                Write-Host $info
                DumpChildren $child ($depth + 1) $maxDepth
            }
        } catch {}
    }
    
    DumpChildren $win 1 6
}