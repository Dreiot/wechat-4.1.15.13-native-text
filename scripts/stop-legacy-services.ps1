param([Parameter(Mandatory=$true)][string]$LegacyRoot)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($LegacyRoot)
if(-not [IO.Path]::IsPathRooted($LegacyRoot) -or -not (Test-Path -LiteralPath (Join-Path $root 'config\wechatagent.json'))){throw 'Legacy project directory is invalid.'}
$stateDir=Join-Path $root 'state';$recordFile=Join-Path $stateDir 'runtime.json'
if(-not (Test-Path -LiteralPath $recordFile)){exit 0}
$script:record=@{}
$saved=Get-Content -LiteralPath $recordFile -Raw -Encoding UTF8|ConvertFrom-Json
foreach($property in $saved.PSObject.Properties){$script:record[$property.Name]=$property.Value}
# Load only ownership-checked stopping functions from THIS installed version.
# Never execute source code from the user's old backup directory.
$tokens=$null;$parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'manage.ps1'),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Current service manager is invalid.'}
foreach($name in @('Save-Record','Owned-Process','Stop-Services')){
    $definition=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    if(-not $definition){throw 'Current service stopping function is missing.'}
    Invoke-Expression $definition.Extent.Text
}
# Old versions can leave relative markers after every process has exited.
# A missing PID is safe to discard; live, unverifiable identities still fail.
$discarded=$false
foreach($name in @($script:record.Keys)){
    $processId=0
    if([int]::TryParse([string]$script:record[$name].pid,[ref]$processId) -and $processId -gt 0 -and -not (Get-CimInstance Win32_Process -Filter ('ProcessId='+$processId))){$script:record.Remove($name);$discarded=$true}
}
if($discarded){Save-Record}
Stop-Services
