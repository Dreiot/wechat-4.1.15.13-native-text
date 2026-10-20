$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $root 'config\wechatagent.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $config.runtime.dshDesktop -or -not (Test-Path -LiteralPath $config.runtime.dshDesktop)) { throw 'DSH_NOT_CONFIGURED: Install DSH from the setup link, then select DeepSeek Harness.exe and save settings.' }
$previousDshHome=$env:DSH_HOME
try {
    $distributionFile=Join-Path $root 'config\distribution.json'
    $arguments=@()
    if(Test-Path -LiteralPath $distributionFile){
        $distribution=Get-Content -LiteralPath $distributionFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if($config.runtime.dshDesktop -eq $distribution.dsh -and $distribution.dshHome){
            $env:DSH_HOME=$distribution.dshHome
            $arguments=@('--user-data-dir="'+(Join-Path $distribution.dshHome 'desktop')+'"')
        }
    }
    if($arguments.Count){Start-Process -FilePath $config.runtime.dshDesktop -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $config.runtime.dshDesktop) -WindowStyle Normal | Out-Null}
    else {Start-Process -FilePath $config.runtime.dshDesktop -WorkingDirectory (Split-Path -Parent $config.runtime.dshDesktop) -WindowStyle Normal | Out-Null}
} finally {$env:DSH_HOME=$previousDshHome}
Write-Output 'DSH opened. Sign in, enable the local WeChatAgent plugin, then restart DSH from its tray menu.'
