param([Parameter(Mandatory=$true)][string]$Package)
$ErrorActionPreference = 'Stop'
$root = 'HKCU:\Software\BaneWfnAssociationTest-' + [Guid]::NewGuid().ToString('N')
$application = Join-Path $Package 'banewfn_gui.exe'
try {
    $null = New-Item -Path "$root\.bwc" -Force
    Set-Item -Path "$root\.bwc" -Value 'Existing.CLI.Script'
    & (Join-Path $Package 'Register-BaneWfn-GUI.ps1') -ClassesRoot $root -Application $application
    $expected = '"' + (Resolve-Path -LiteralPath $application).Path + '" --script "%1"'
    $command = (Get-Item "$root\BaneWfn.GUI.Script\shell\open\command").GetValue('')
    if ($command -ne $expected) { throw "Unexpected association command: $command" }
    if ((Get-Item "$root\.bwc").GetValue('') -ne 'Existing.CLI.Script') { throw 'Existing default changed' }
    foreach ($extension in '.bw', '.bwc') {
        if ('BaneWfn.GUI.Script' -notin (Get-Item "$root\$extension\OpenWithProgids").GetValueNames()) {
            throw "Missing Open with registration for $extension"
        }
    }
    Write-Output 'PASS: quoted GUI script command and both extensions; existing CLI default preserved'
} finally {
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
