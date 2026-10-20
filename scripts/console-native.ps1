param([ValidateSet('exe','folder','workspace','protect')][string]$Kind)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
if ($Kind -eq 'protect') {
    Add-Type -AssemblyName System.Security
    $secret = [Console]::In.ReadToEnd()
    $bytes = [Text.Encoding]::UTF8.GetBytes($secret)
    $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Write('userdpapi:' + [Convert]::ToBase64String($protected))
    exit 0
}
Add-Type -AssemblyName System.Windows.Forms
if ($Kind -in @('folder','workspace')) {
    $dialog = [Windows.Forms.FolderBrowserDialog]::new()
    $dialog.Description = if ($Kind -eq 'workspace') { 'Select the workspace directory' } else { 'Select the local WeChat database directory' }
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }
} else {
    $dialog = [Windows.Forms.OpenFileDialog]::new()
    $dialog.Filter = 'Programs (*.exe)|*.exe|All files (*.*)|*.*'
    $dialog.CheckFileExists = $true
    if ($dialog.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.FileName) }
}
$dialog.Dispose()
