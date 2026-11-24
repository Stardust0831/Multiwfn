[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Package,
      [Parameter(Mandatory=$true)][string]$Output)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class NativeDesktop {
    [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder value, uint length, out uint needed);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr parameter, StringBuilder value);
}
'@

$Package = [IO.Path]::GetFullPath($Package)
$Output = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force $Output | Out-Null
$script:stage = 'desktop'
$script:app = $null
$script:records = [Collections.Generic.List[object]]::new()
$script:environment = [ordered]@{}
$rootElement = [System.Windows.Automation.AutomationElement]::RootElement
$scope = [System.Windows.Automation.TreeScope]::Descendants
$all = [System.Windows.Automation.Condition]::TrueCondition

function Write-Json($Name, $Value) {
    $Value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $Output $Name) -Encoding UTF8
}
function Hash-File($Path) {
    if (Test-Path -LiteralPath $Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }
    return $null
}
function Wait-For([scriptblock]$Condition, [string]$Description, [int]$Seconds=30) {
    $until = [DateTime]::UtcNow.AddSeconds($Seconds)
    $lastError = ''
    while ([DateTime]::UtcNow -lt $until) {
        try { $value = & $Condition; if ($value) { return $value } }
        catch { $lastError = $_.Exception.Message }
        if ($null -ne $script:app -and $script:app.HasExited) { throw "Application exited: $($script:app.ExitCode)" }
        Start-Sleep -Milliseconds 200
    }
    throw "Timed out: $Description; last UIA error: $lastError"
}
function Find-Name([string]$Name, $Root=$rootElement) {
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    return $Root.FindFirst($scope, $condition)
}
function Click-Element($Element) {
    if (-not $Element.Current.IsEnabled) { throw "Disabled control: $($Element.Current.Name)" }
    $pattern = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        $pattern.Invoke()
        return
    }
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
        $pattern.Expand()
        return
    }
    # Only this disposable Actions desktop receives input. Coordinates come
    # from the current accessibility element, never a guessed screen position.
    $bounds = $Element.Current.BoundingRectangle
    if ($bounds.IsEmpty -or $Element.Current.IsOffscreen) { throw 'Control has no visible bounds' }
    [void][NativeDesktop]::SetCursorPos([int]($bounds.X+$bounds.Width/2), [int]($bounds.Y+$bounds.Height/2))
    [NativeDesktop]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [NativeDesktop]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
}
function Click-Name([string]$Name, $Root=$rootElement) {
    $element = Wait-For { Find-Name $Name $Root } "control $Name"
    Click-Element $element
}
function Capture([string]$Name) {
    $lines = [Collections.Generic.List[string]]::new()
    try {
        foreach ($element in $rootElement.FindAll($scope, $all)) {
            $c = $element.Current
            $patterns = ($element.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }) -join ','
            $lines.Add("$($c.ControlType.ProgrammaticName) name=$($c.Name) id=$($c.AutomationId) pid=$($c.ProcessId) hwnd=$($c.NativeWindowHandle) patterns=$patterns bounds=$($c.BoundingRectangle)")
            if ($lines.Count -ge 2000) { break }
        }
    } catch { $lines.Add("UIA snapshot error: $($_.Exception.Message)") }
    $lines | Set-Content (Join-Path $Output "$Name.txt") -Encoding UTF8
    try {
        $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $bitmap = [Drawing.Bitmap]::new($screen.Width, $screen.Height)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $screen.Size)
            $bitmap.Save((Join-Path $Output "$Name.png"), [Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    } catch { $_.Exception.Message | Set-Content (Join-Path $Output "$Name-screenshot-error.txt") }
}
function Set-Filename($Dialog, [string]$Path) {
    $edit = Wait-For {
        # Windows Server 2025 exposes this native edit as ControlType.Pane.
        # Another address-bar control has the same ID, so scope to its host.
        $condition = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'FileNameControlHost')
        $hostElement = $Dialog.FindFirst($scope, $condition)
        if ($null -eq $hostElement) { return $null }
        foreach ($element in $hostElement.FindAll($scope, $all)) {
            $c = $element.Current
            if ($c.AutomationId -in @('1001','1148')) {
                return $element
            }
        }
    } 'native filename field'
    $value = $null
    if ($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) {
        $value.SetValue($Path)
        if ($value.Current.Value -ne $Path) { throw 'Native filename value was not set' }
    } else {
        $handle = [IntPtr]$edit.Current.NativeWindowHandle
        if ($handle -eq [IntPtr]::Zero) { throw 'Native filename field exposes neither ValuePattern nor HWND' }
        # Typing also updates IFileDialog's internal filename. WM_SETTEXT alone
        # updates the child HWND's visible text without committing that state.
        Click-Element $edit
        [System.Windows.Forms.SendKeys]::SendWait('^a')
        $keys = -join ($Path.ToCharArray() | ForEach-Object {
            if ('+^%~(){}[]'.Contains([string]$_)) { '{' + $_ + '}' } else { [string]$_ }
        })
        [System.Windows.Forms.SendKeys]::SendWait($keys)
        [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
        $readback = [Text.StringBuilder]::new(32768)
        [void][NativeDesktop]::SendMessage($handle, 0x000D, [IntPtr]32768, $readback)
        if ($readback.ToString() -ne $Path) { throw 'Native filename HWND readback differs from requested path' }
    }
}
function Inspect-Png([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ([BitConverter]::ToString($bytes[0..7]) -ne '89-50-4E-47-0D-0A-1A-0A') { throw 'Invalid PNG signature' }
    $bitmap = [Drawing.Bitmap]::new($Path)
    try {
        if ($bitmap.Width -lt 100 -or $bitmap.Height -lt 100) { throw 'PNG is unexpectedly small' }
        $colors = [Collections.Generic.HashSet[int]]::new()
        $step = [Math]::Max(1, [int]([Math]::Max($bitmap.Width,$bitmap.Height)/500))
        for ($y=0; $y -lt $bitmap.Height; $y+=$step) {
            for ($x=0; $x -lt $bitmap.Width; $x+=$step) { [void]$colors.Add($bitmap.GetPixel($x,$y).ToArgb()) }
        }
        if ($colors.Count -lt 100) { throw "PNG lacks rendered scene colors: $($colors.Count)" }
        return @{width=$bitmap.Width; height=$bitmap.Height; colors=$colors.Count; bytes=$bytes.Length; sha256=(Hash-File $Path)}
    } finally { $bitmap.Dispose() }
}

try {
    $station = [Text.StringBuilder]::new(256)
    [uint32]$needed = 0
    $stationOk = [NativeDesktop]::GetUserObjectInformation([NativeDesktop]::GetProcessWindowStation(),2,$station,512,[ref]$needed)
    $desktop = [NativeDesktop]::OpenInputDesktop(0,$false,1)
    $desktopError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    $desktopName = [Text.StringBuilder]::new(256)
    if ($desktop -ne [IntPtr]::Zero) {
        [void][NativeDesktop]::GetUserObjectInformation($desktop,2,$desktopName,512,[ref]$needed)
        [void][NativeDesktop]::CloseDesktop($desktop)
    }
    $script:environment = [ordered]@{
        platform='Windows'; os=[Environment]::OSVersion.VersionString
        runnerImage=$env:ImageOS; runnerVersion=$env:ImageVersion
        userInteractive=[Environment]::UserInteractive
        processSession=(Get-Process -Id $PID).SessionId
        sessionName=$env:SESSIONNAME; windowStation=$station.ToString(); stationQuery=$stationOk
        inputDesktop=$desktopName.ToString(); openInputDesktopError=$desktopError
        inputDesktopAccessible=($desktop -ne [IntPtr]::Zero)
        desktopBounds=([System.Windows.Forms.SystemInformation]::VirtualScreen).ToString()
        uiAutomationRoot=$rootElement.Current.Name
    }
    & qwinsta 2>&1 | Out-String | Set-Content (Join-Path $Output 'sessions.txt')
    $script:environment.webview2 = @(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.name -match 'WebView' } | Select-Object name,pv)
    Write-Json 'environment.json' $script:environment
    Capture 'desktop'
    if (-not [Environment]::UserInteractive -or $desktop -eq [IntPtr]::Zero) {
        throw "BLOCKED: no accessible input desktop; session=$($script:environment.processSession), Win32=$desktopError"
    }

    $session = Join-Path $Output 'session'
    New-Item -ItemType Directory -Force $session | Out-Null
    [IO.File]::WriteAllText((Join-Path $session 'water.xyz'), "3`nwater`nO 0 0 0`nH 0 0 0.96`nH 0.92 0 -0.24`n")
    [IO.File]::WriteAllText((Join-Path $session 'manifest.json'), '{"structure":{"path":"water.xyz","format":"xyz"},"cubes":[]}')
    $script:stage = 'launch'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
    $arguments = @('--frontend', ('"'+(Join-Path $Package 'resources/frontend/matterviz-viewer/dist')+'"'),
                   '--session', ('"'+$session+'"'), '--manifest', ('"'+(Join-Path $session 'manifest.json')+'"'),
                   '--port','0','--startup-timeout','120')
    $script:app = Start-Process -FilePath (Join-Path $Package 'resources/tools/matterviz-desktop.exe') -ArgumentList $arguments -PassThru `
        -RedirectStandardOutput (Join-Path $Output 'host.stdout.log') -RedirectStandardError (Join-Path $Output 'host.stderr.log')
    $script:stage = 'webview-accessibility'
    Wait-For { Find-Name 'Structure loaded' } 'loaded structure in WebView2' 90 | Out-Null
    Capture 'startup'
    $target = Join-Path $Output 'export.png'
    foreach ($mode in @('cancel','save','refuse-overwrite','overwrite')) {
        $before = Hash-File $target
        if ($mode -eq 'overwrite') {
            [IO.File]::WriteAllText($target, "MWFN overwrite sentinel`n")
            Copy-Item $target (Join-Path $Output 'before-overwrite.bin')
            $before = Hash-File $target
        }
        $script:stage = "$mode-render"
        Click-Name 'Save'
        Click-Name 'PNG image'
        $script:stage = "$mode-chooser"
        $dialog = Wait-For { Find-Name 'Save viewer export' } 'native Save dialog' 45
        Capture "$mode-dialog"
        if ($mode -eq 'cancel') {
            Click-Name 'Cancel' $dialog
        } else {
            Set-Filename $dialog $target
            Capture "$mode-filename"
            Click-Name 'Save' $dialog
            if ($mode -in @('refuse-overwrite','overwrite')) {
                $replace = Wait-For { Find-Name 'Yes' } 'native replacement confirmation'
                Capture "$mode-confirmation"
                if ($mode -eq 'refuse-overwrite') {
                    Click-Name 'No'
                    Wait-For { -not (Find-Name 'Yes') } 'dismiss overwrite confirmation' | Out-Null
                    Click-Name 'Cancel' $dialog
                } else { Click-Element $replace }
            }
        }
        $script:stage = "$mode-file"
        $image = $null
        if ($mode -in @('cancel','refuse-overwrite')) {
            Wait-For { Find-Name 'Save cancelled' } 'cancelled status' | Out-Null
            if ((Hash-File $target) -ne $before) { throw 'Cancellation changed the target file' }
        } else {
            Wait-For { Find-Name 'PNG exported' } 'completed native write' | Out-Null
            $image = Inspect-Png $target
            if ($mode -eq 'overwrite' -and (Hash-File $target) -eq $before) { throw 'Confirmed overwrite retained the sentinel' }
            Copy-Item $target (Join-Path $Output "$mode.png")
        }
        Capture "$mode-result"
        $script:records.Add(@{case=$mode; before=$before; after=(Hash-File $target); png=$image; passed=$true})
        Write-Json 'results.json' @{status='in_progress'; stage=$script:stage; cases=$script:records}
    }
    Write-Json 'results.json' @{status='passed'; stage='complete'; cases=$script:records}
} catch {
    $failure = $_
    Capture 'failure'
    $status = if ($failure.Exception.Message.StartsWith('BLOCKED:')) {'blocked'} else {'failed'}
    Write-Json 'results.json' @{status=$status; stage=$script:stage; error=$failure.Exception.ToString(); cases=$script:records}
    throw
} finally {
    if ($null -ne $script:app -and -not $script:app.HasExited) { Stop-Process -Id $script:app.Id -Force }
}
