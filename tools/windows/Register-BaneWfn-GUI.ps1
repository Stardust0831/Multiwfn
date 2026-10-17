param(
    [string]$ClassesRoot = 'HKCU:\Software\Classes',
    [string]$Application = (Join-Path $PSScriptRoot 'banewfn_gui.exe')
)
$ErrorActionPreference = 'Stop'
$Application = (Resolve-Path -LiteralPath $Application).Path
function Set-RegistryText([string]$Path, [string]$Name, [string]$Value) {
    $null = New-Item -Path $Path -Force
    $null = New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType String -Force
}
$progId = 'BaneWfn.GUI.Script'
$command = '"' + $Application + '" --script "%1"'
Set-RegistryText "$ClassesRoot\$progId" '(default)' 'BaneWfn workflow script'
Set-RegistryText "$ClassesRoot\$progId\DefaultIcon" '(default)' ('"' + $Application + '",0')
Set-RegistryText "$ClassesRoot\$progId\shell\open\command" '(default)' $command
$appKey = "$ClassesRoot\Applications\banewfn_gui.exe"
Set-RegistryText $appKey 'FriendlyAppName' 'BaneWfn GUI'
Set-RegistryText "$appKey\shell\open\command" '(default)' $command
foreach ($extension in '.bw', '.bwc') {
    Set-RegistryText "$ClassesRoot\$extension\OpenWithProgids" $progId ''
    Set-RegistryText "$appKey\SupportedTypes" $extension ''
}
Write-Output 'BaneWfn GUI is available in Open with for .bw and .bwc files.'
Write-Output 'Choose BaneWfn GUI in Windows Open with to make it the default.'
