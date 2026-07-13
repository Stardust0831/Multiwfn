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
$packageHome = Split-Path -Parent $executable
$packagedTools = Join-Path $packageHome "resources\tools"
$process = $null
$processStarted = $false
$stdoutTask = $null
$stderrTask = $null
$success = $false
$hostPort = 18767

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
        (Join-Path $session "gui_request.txt"),
        (Join-Path $session "gui_stop.flag")
    )) {
        if (Test-Path -LiteralPath $path) {
            Write-Host "--- $path ---"
            Get-Content -LiteralPath $path -Raw | Write-Host
        }
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

function Get-SessionCapability([int] $Port) {
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    try {
        $result = $client.GetAsync("http://127.0.0.1:$Port/").GetAwaiter().GetResult()
        $location = [string]$result.Headers.Location
        $match = [regex]::Match($location, '[?&]cap=([0-9a-f]{64})')
        if (-not $match.Success) { throw "Rust MatterViz host capability was not advertised" }
        return $match.Groups[1].Value
    }
    finally {
        $client.Dispose()
        $handler.Dispose()
    }
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
    if (-not (Test-Path -LiteralPath (Join-Path $packagedTools "matterviz-desktop.exe"))) {
        throw "Packaged Rust MatterViz host was not found under $packagedTools"
    }
    Copy-Item -LiteralPath (Join-Path $packagedTools "matterviz-desktop.exe") -Destination $fakeTools
    Get-ChildItem -LiteralPath $packagedTools -Filter *.dll -File | Copy-Item -Destination $fakeTools

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
    $psi.Environment["MULTIWFN_MATTERVIZ_PORT"] = $hostPort.ToString()

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

    Wait-ForCondition {
        try {
            $null = Invoke-WebRequest -UseBasicParsing `
                -Uri "http://127.0.0.1:$hostPort/session/manifest.json" -TimeoutSec 2
            return (-not $process.HasExited)
        }
        catch { return $false }
    } 30 "Rust MatterViz host did not expose the generated session"
    $capability = Get-SessionCapability $hostPort

    $orbitalPayload = Invoke-RestMethod -Uri (
        "http://127.0.0.1:$hostPort/api/orbital" +
        "?index=0&quality=25000&isovalue=0.05&cap=$capability"
    )
    if (-not $orbitalPayload.ok -or -not $orbitalPayload.clear) {
        throw "Rust orbital API did not round-trip through the live Multiwfn request loop"
    }
    if (Test-Path -LiteralPath (Join-Path $session "gui_request.txt")) {
        throw "Rust orbital API left an unconsumed backend request"
    }
    if ($process.HasExited) { throw "Multiwfn exited before the orbital API response" }

    $returnPayload = Invoke-RestMethod -Uri "http://127.0.0.1:$hostPort/api/return?cap=$capability"
    if (-not $returnPayload.ok) { throw "Rust MatterViz host Return request failed" }
    if (-not $process.WaitForExit(20000)) {
        throw "Multiwfn did not exit after the Rust host Return request"
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
    if (Test-Path -LiteralPath $root) {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (-not $success) { throw "MatterViz asynchronous launch regression did not complete" }
Write-Host "MatterViz asynchronous launch regression passed"
