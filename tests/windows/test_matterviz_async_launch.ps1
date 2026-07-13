[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ExecutablePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$executable = [IO.Path]::GetFullPath($ExecutablePath)
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Packaged Multiwfn executable was not found: $executable"
}

$root = Join-Path ([IO.Path]::GetTempPath()) ("multiwfn matterviz async " + [Guid]::NewGuid().ToString("N"))
$work = Join-Path $root "work"
$session = Join-Path $root "session data"
$fakeHome = Join-Path $root "fake matterviz home"
$fakeTools = Join-Path $fakeHome "tools"
$fakeFrontend = Join-Path $fakeHome "frontend\matterviz-viewer\dist"
$process = $null
$processStarted = $false
$launcherPid = $null
$stdoutTask = $null
$stderrTask = $null
$response = $null
$success = $false

function Write-Ascii([string] $Path, [string] $Text) {
    [IO.File]::WriteAllText($Path, $Text, [Text.Encoding]::ASCII)
}

function Show-Diagnostics {
    Write-Host "MatterViz asynchronous launch regression diagnostics:"
    Write-Host "  root: $root"
    if ($null -ne $process -and $processStarted) {
        Write-Host "  Multiwfn process exited: $($process.HasExited)"
        if ($process.HasExited) { Write-Host "  Multiwfn exit code: $($process.ExitCode)" }
    }
    foreach ($path in @(
        (Join-Path $session "manifest.json"),
        (Join-Path $session "launcher.ready"),
        (Join-Path $session "gui_request.txt"),
        (Join-Path $session "gui_stop.flag")
    )) {
        if (Test-Path -LiteralPath $path) {
            Write-Host "--- $path ---"
            Get-Content -LiteralPath $path -Raw | Write-Host
        }
    }
    if ($null -ne $response -and (Test-Path -LiteralPath $response)) {
        Write-Host "--- $response ---"
        Get-Content -LiteralPath $response -Raw | Write-Host
    }
    if (Test-Path -LiteralPath $session) {
        Get-ChildItem -LiteralPath $session -Force | Select-Object Name, Length | Format-Table | Out-String | Write-Host
    }
    if ($null -ne $stdoutTask -and $stdoutTask.IsCompleted) {
        Write-Host "--- Multiwfn stdout ---"
        $stdoutTask.GetAwaiter().GetResult() | Write-Host
    }
    if ($null -ne $stderrTask -and $stderrTask.IsCompleted) {
        Write-Host "--- Multiwfn stderr ---"
        $stderrTask.GetAwaiter().GetResult() | Write-Host
    }
}

function Wait-ForCondition([scriptblock] $Condition, [int] $TimeoutSeconds, [string] $FailureMessage) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 250
    }
    throw $FailureMessage
}

function Read-JsonWithTimeout([string] $Path, [int] $TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
        }
        catch [IO.IOException] { }
        catch [System.ArgumentException] { }
        catch [System.Management.Automation.RuntimeException] { }
        Start-Sleep -Milliseconds 100
    }
    throw "Timed out reading valid JSON from $Path"
}

try {
    New-Item -ItemType Directory -Force -Path $work, $session, $fakeTools, $fakeFrontend | Out-Null
    Write-Ascii (Join-Path $work "tiny.xyz") @"
3
MatterViz async launch regression
O 0.000000 0.000000 0.000000
H 0.000000 0.000000 0.960000
H 0.920000 0.000000 -0.240000
"@
    Write-Ascii (Join-Path $fakeFrontend "index.html") "<!doctype html><title>fake MatterViz</title>"
    $fakeServer = @'
import argparse
from pathlib import Path
import os
import time

parser = argparse.ArgumentParser()
parser.add_argument("--frontend", required=True)
parser.add_argument("--session", required=True)
parser.add_argument("--manifest", required=True)
parser.add_argument("--open", action="store_true")
args = parser.parse_args()
session = Path(args.session)
session.mkdir(parents=True, exist_ok=True)
(session / "launcher.ready").write_text(f"{os.getpid()}\n", encoding="ascii")
while True:
    time.sleep(0.25)
'@
    Write-Ascii (Join-Path $fakeTools "multiwfn_matterviz_server.py") $fakeServer

    $pythonExecutable = (Get-Command python -ErrorAction Stop).Source
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $executable
    $psi.WorkingDirectory = $work
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $inputPath = Join-Path $work "tiny.xyz"
    $psi.Arguments = '"' + $inputPath.Replace('"', '\"') + '"'
    $psi.Environment["MULTIWFN_MATTERVIZ_SESSION"] = $session
    $psi.Environment["MULTIWFN_MATTERVIZ_HOME"] = $fakeHome
    $psi.Environment["MULTIWFN_MATTERVIZ_SHELL"] = "browser"
    $psi.Environment["MULTIWFN_MATTERVIZ_PYTHON"] = $pythonExecutable

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $psi
    if (-not $process.Start()) { throw "Could not start packaged Multiwfn executable" }
    $processStarted = $true
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.WriteLine("0")
    $process.StandardInput.WriteLine("q")
    $process.StandardInput.Flush()

    Wait-ForCondition {
        (Test-Path -LiteralPath (Join-Path $session "manifest.json")) -and
        -not $process.HasExited
    } 30 "Multiwfn did not publish a MatterViz manifest while processing menu 0"

    $launcherReady = Join-Path $session "launcher.ready"
    Wait-ForCondition {
        (Test-Path -LiteralPath $launcherReady) -and -not $process.HasExited
    } 30 "Fake MatterViz launcher did not report readiness"
    $launcherPid = [int]((Get-Content -LiteralPath $launcherReady -Raw).Trim())
    if ($launcherPid -le 0) { throw "Fake MatterViz launcher wrote an invalid PID" }
    if ($null -eq (Get-Process -Id $launcherPid -ErrorAction SilentlyContinue)) {
        throw "Fake MatterViz launcher exited before the request test"
    }

    $requestId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $request = Join-Path $session "gui_request.txt"
    Write-Ascii $request ("{0} unknown`n" -f $requestId)
    $response = Join-Path $session ("response_{0}.json" -f $requestId)
    Wait-ForCondition {
        (Test-Path -LiteralPath $response) -and
        -not (Test-Path -LiteralPath $request)
    } 20 "Multiwfn did not consume the GUI request and publish its response"
    $payload = Read-JsonWithTimeout $response 5
    if ($payload.ok -ne $false) { throw "Unknown GUI request did not return an error response" }
    if ($null -eq (Get-Process -Id $launcherPid -ErrorAction SilentlyContinue)) {
        throw "Fake MatterViz launcher exited before the response was published"
    }

    Write-Ascii (Join-Path $session "gui_stop.flag") "test-stop`n"
    if (-not $process.WaitForExit(20000)) {
        throw "Multiwfn did not exit after gui_stop.flag was written"
    }
    if ($process.ExitCode -ne 0) { throw "Multiwfn exited with status $($process.ExitCode)" }
    $success = $true
}
catch {
    Show-Diagnostics
    throw
}
finally {
    if ($null -ne $process -and $processStarted) {
        if (-not $process.HasExited) {
            try {
                $process.Kill()
                [void] $process.WaitForExit(5000)
            }
            catch [InvalidOperationException] {
                # The process can exit between HasExited and Kill during cleanup.
            }
        }
        $process.Dispose()
    }
    if ($null -ne $launcherPid) {
        $launcher = Get-Process -Id $launcherPid -ErrorAction SilentlyContinue
        if ($null -ne $launcher) {
            $launcher | Stop-Process -Force -ErrorAction SilentlyContinue
        }
    }
    if (Test-Path -LiteralPath $root) {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (-not $success) { throw "MatterViz asynchronous launch regression did not complete" }
Write-Host "MatterViz asynchronous launch regression passed"
