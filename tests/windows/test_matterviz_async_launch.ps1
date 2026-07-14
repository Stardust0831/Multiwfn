[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ExecutablePath,
    [string] $FixturePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System.Collections.Concurrent;
using System.IO;
using System.Threading.Tasks;

public static class MatterVizAsyncLineCollector
{
    public static async Task DrainAsync(
        StreamReader reader,
        ConcurrentQueue<string> lines)
    {
        string line;
        while ((line = await reader.ReadLineAsync().ConfigureAwait(false)) != null)
        {
            lines.Enqueue(line);
        }
    }
}
'@

$executable = [IO.Path]::GetFullPath($ExecutablePath)
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Packaged Multiwfn executable was not found: $executable"
}
$fixture = if ([string]::IsNullOrWhiteSpace($FixturePath)) {
    Join-Path $PSScriptRoot "..\fixtures\matterviz-real-orbital-Co5Cr.fch.gz"
} else {
    $FixturePath
}
$fixture = [IO.Path]::GetFullPath($fixture)
if (-not (Test-Path -LiteralPath $fixture -PathType Leaf)) {
    throw "Packaged orbital fixture was not found: $fixture"
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
$stdoutLines = [Collections.Concurrent.ConcurrentQueue[string]]::new()
$stderrLines = [Collections.Concurrent.ConcurrentQueue[string]]::new()
$stdoutDrainTask = $null
$stderrDrainTask = $null
$success = $false
$hostPort = 18767
$serviceBase = $null
$capability = $null
$desktopProcess = $null

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
    if ($null -ne $desktopProcess) {
        Write-Host "  MatterViz desktop process ID: $($desktopProcess.Id)"
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
    if ($stdoutLines.Count -gt 0) {
        Write-Host "--- Multiwfn stdout ---"
        [string]::Join([Environment]::NewLine, $stdoutLines.ToArray()) | Write-Host
    }
    if ($stderrLines.Count -gt 0) {
        Write-Host "--- Multiwfn stderr ---"
        [string]::Join([Environment]::NewLine, $stderrLines.ToArray()) | Write-Host
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

function Get-ServiceBaseUrl {
    foreach ($line in @($stderrLines.ToArray()) + @($stdoutLines.ToArray())) {
        $match = [regex]::Match($line, 'Multiwfn MatterViz GUI service: (http://\S+)')
        if ($match.Success) {
            $uri = [Uri]$match.Groups[1].Value
            $hasExplicitPort = $uri.Authority -match ':\d+$'
            if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'http' -or
                -not $uri.IsLoopback -or -not [string]::IsNullOrEmpty($uri.UserInfo) -or
                -not $hasExplicitPort -or $uri.Port -le 0) {
                throw "Rust MatterViz host advertised an invalid service URL: $uri"
            }
            return $uri.GetLeftPart([UriPartial]::Authority)
        }
    }
    return $null
}

function Get-SessionCapability([string] $BaseUrl) {
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    try {
        $result = $client.GetAsync("$BaseUrl/").GetAwaiter().GetResult()
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

function Get-ServiceProcess([string] $BaseUrl, [string] $ExpectedPath) {
    $uri = [Uri]$BaseUrl
    $address = [Net.IPAddress]::Parse($uri.Host)
    $connection = Get-NetTCPConnection -State Listen -LocalPort $uri.Port `
        -ErrorAction SilentlyContinue | Where-Object {
            try { return [Net.IPAddress]::Parse($_.LocalAddress).Equals($address) }
            catch { return $false }
        } | Select-Object -First 1
    if ($null -eq $connection) { return $null }
    $candidate = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
    if ($null -eq $candidate) { return $null }
    $actual = [IO.Path]::GetFullPath($candidate.Path)
    $expected = [IO.Path]::GetFullPath($ExpectedPath)
    if (-not $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { return $null }
    return $candidate
}

function Get-Crc32C([byte[]] $Bytes) {
    [uint32]$crc = [uint32]::MaxValue
    foreach ($byte in $Bytes) {
        $crc = $crc -bxor [uint32]$byte
        for ($bit = 0; $bit -lt 8; $bit++) {
            if (($crc -band 1) -ne 0) {
                $crc = ($crc -shr 1) -bxor [uint32]0x82F63B78
            } else {
                $crc = $crc -shr 1
            }
        }
    }
    return [uint32]($crc -bxor [uint32]::MaxValue)
}

try {
    New-Item -ItemType Directory -Force -Path $work, $session, $fakeTools, $fakeFrontend | Out-Null
    $inputPath = Join-Path $work "Co5Cr.fch"
    $fixtureStream = [IO.File]::OpenRead($fixture)
    $inputStream = [IO.File]::Create($inputPath)
    $gzipStream = [IO.Compression.GZipStream]::new(
        $fixtureStream, [IO.Compression.CompressionMode]::Decompress)
    try { $gzipStream.CopyTo($inputStream) }
    finally {
        $gzipStream.Dispose()
        $inputStream.Dispose()
        $fixtureStream.Dispose()
    }
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
    $psi.Arguments = '"' + $inputPath.Replace('"', '\"') + '"'
    $psi.Environment["MULTIWFN_MATTERVIZ_SESSION"] = $session
    $psi.Environment["MULTIWFN_MATTERVIZ_HOME"] = $fakeHome
    $psi.Environment["MULTIWFN_MATTERVIZ_PORT"] = $hostPort.ToString()

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $psi
    if (-not $process.Start()) { throw "Could not start packaged Multiwfn executable" }
    $processStarted = $true
    $stdoutDrainTask = [MatterVizAsyncLineCollector]::DrainAsync(
        $process.StandardOutput, $stdoutLines)
    $stderrDrainTask = [MatterVizAsyncLineCollector]::DrainAsync(
        $process.StandardError, $stderrLines)
    $process.StandardInput.WriteLine("0")
    $process.StandardInput.WriteLine("q")
    $process.StandardInput.Flush()

    Wait-ForCondition {
        (Test-Path -LiteralPath (Join-Path $session "manifest.json")) -and
        -not $process.HasExited
    } 30 "Multiwfn did not publish a MatterViz manifest while processing menu 0"

    Wait-ForCondition {
        $candidate = Get-ServiceBaseUrl
        if ([string]::IsNullOrWhiteSpace($candidate)) { return $false }
        try {
            $null = Invoke-WebRequest -UseBasicParsing `
                -Uri "$candidate/session/manifest.json" -TimeoutSec 2
            $script:serviceBase = $candidate
            return (-not $process.HasExited)
        }
        catch { return $false }
    } 30 "Rust MatterViz host did not expose the generated session"
    Wait-ForCondition {
        $script:desktopProcess = Get-ServiceProcess $serviceBase (Join-Path $fakeTools "matterviz-desktop.exe")
        return ($null -ne $desktopProcess)
    } 5 "Could not identify the Rust MatterViz host process"
    $capability = Get-SessionCapability $serviceBase

    $orbitalUrl = "$serviceBase/api/orbital?index=43&quality=25000&isovalue=0.05&cap=$capability"
    $volumePath = Join-Path $root "orbital-43.mwfnvol"
    $orbitalResponse = Invoke-WebRequest -UseBasicParsing -Uri $orbitalUrl -OutFile $volumePath -PassThru
    $volumeBytes = [IO.File]::ReadAllBytes($volumePath)
    if ($orbitalResponse.StatusCode -ne 200 -or
        [string]$orbitalResponse.Headers["Content-Type"] -ne "application/vnd.multiwfn.volume; version=2") {
        throw "Native orbital response did not return the v2 binary content type"
    }
    if ($volumeBytes.Length -lt 304 -or
        [Text.Encoding]::ASCII.GetString($volumeBytes, 0, 8) -ne "MWFNVOL`0") {
        throw "Native orbital volume response is truncated or has invalid magic"
    }
    $major = [BitConverter]::ToUInt16($volumeBytes, 8)
    $minor = [BitConverter]::ToUInt16($volumeBytes, 10)
    $messageType = [BitConverter]::ToUInt16($volumeBytes, 12)
    $flags = [BitConverter]::ToUInt16($volumeBytes, 14)
    $headerBytes = [BitConverter]::ToUInt32($volumeBytes, 16)
    if ($major -ne 2 -or $minor -ne 0 -or $messageType -ne 4 -or $flags -ne 3 -or $headerBytes -ne 304) {
        throw "Native orbital volume response has invalid v2 metadata"
    }
    $header = [byte[]]$volumeBytes[0..303]
    $expectedHeaderCrc = [BitConverter]::ToUInt32($header, 36)
    36..39 | ForEach-Object { $header[$_] = 0 }
    if ((Get-Crc32C $header) -ne $expectedHeaderCrc) {
        throw "Native orbital volume header CRC32C mismatch"
    }
    $bodyBytes = [BitConverter]::ToUInt64($volumeBytes, 28)
    $volumeId = [BitConverter]::ToUInt64($volumeBytes, 48)
    $nx = [BitConverter]::ToUInt32($volumeBytes, 56)
    $ny = [BitConverter]::ToUInt32($volumeBytes, 60)
    $nz = [BitConverter]::ToUInt32($volumeBytes, 64)
    $sampleCount = [uint64]$nx * [uint64]$ny * [uint64]$nz
    if ($volumeId -eq 0 -or $nx -eq 0 -or $ny -eq 0 -or $nz -eq 0 -or
        $bodyBytes -ne ($sampleCount * 8) -or $volumeBytes.Length -ne (304 + [int]$bodyBytes)) {
        throw "Native orbital volume response has invalid dimensions or body length"
    }
    $body = [byte[]]$volumeBytes[304..($volumeBytes.Length - 1)]
    $expectedBodyCrc = [BitConverter]::ToUInt32($volumeBytes, 40)
    if ((Get-Crc32C $body) -ne $expectedBodyCrc) {
        throw "Native orbital volume body CRC32C mismatch"
    }
    if (Test-Path -LiteralPath (Join-Path $session "orbital_43_25000.cube")) {
        throw "Successful native orbital publication unexpectedly staged a dynamic Cube"
    }
    if (Test-Path -LiteralPath (Join-Path $session "gui_request.txt")) {
        throw "Rust orbital API left an unconsumed backend request"
    }
    if ($process.HasExited) { throw "Multiwfn exited before the orbital API response" }

    $returnPayload = Invoke-RestMethod -Uri "$serviceBase/api/return?cap=$capability"
    if (-not $returnPayload.ok) { throw "Rust MatterViz host Return request failed" }
    if (-not $process.WaitForExit(20000)) {
        throw "Multiwfn did not exit after the Rust host Return request"
    }
    if ($process.ExitCode -ne 0) { throw "Multiwfn exited with status $($process.ExitCode)" }
    $drainTasks = [Threading.Tasks.Task[]]@($stdoutDrainTask, $stderrDrainTask)
    if (-not [Threading.Tasks.Task]::WaitAll($drainTasks, 10000)) {
        throw "MatterViz desktop did not close its inherited output handles after Return"
    }
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
                & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null
                [void] $process.WaitForExit(5000)
            }
            catch [InvalidOperationException] {
                # The process can exit between HasExited and Kill during cleanup.
            }
        }
    }
    if (-not $success -and $null -ne $desktopProcess) {
        try {
            if (-not $desktopProcess.HasExited) {
                $desktopProcess.Kill()
                [void] $desktopProcess.WaitForExit(5000)
            }
        }
        catch [InvalidOperationException] { }
    }
    if ($null -ne $desktopProcess) { $desktopProcess.Dispose() }
    $outputsClosed = $false
    if ($null -ne $stdoutDrainTask -and $null -ne $stderrDrainTask) {
        $drainTasks = [Threading.Tasks.Task[]]@($stdoutDrainTask, $stderrDrainTask)
        $outputsClosed = [Threading.Tasks.Task]::WaitAll($drainTasks, 5000)
    }
    if ($null -ne $process) { $process.Dispose() }
    if ($outputsClosed -and (Test-Path -LiteralPath $root)) {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
    elseif (Test-Path -LiteralPath $root) {
        Write-Warning "Retained MatterViz async diagnostics because descendant output handles remain open: $root"
    }
}

if (-not $success) { throw "MatterViz asynchronous launch regression did not complete" }
Write-Host "MatterViz asynchronous launch regression passed"
