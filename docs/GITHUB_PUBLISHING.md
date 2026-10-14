# GitHub 发布步骤

本目录为 WeChatAgent 0.3.4 公开源码，对应 sourcepro5/WeChatAgent 的 main 分支。新版本使用 v0.3.4 标签；源码与安装包分别上传。

首次使用 GitHub CLI 时运行 `gh auth login` 和 `gh auth setup-git`。在 PowerShell 执行：

```powershell
npm run privacy:check
if ($LASTEXITCODE -ne 0) { throw '源码隐私检查失败。' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw '源码差异检查失败。' }
git add -A
if ($LASTEXITCODE -ne 0) { throw '暂存失败。' }
git diff --cached --stat
git commit -m "Release WeChatAgent 0.3.4"
if ($LASTEXITCODE -ne 0) { throw '提交失败。' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw '源码推送失败。' }
git tag -a v0.3.4 -m "WeChatAgent 0.3.4"
if ($LASTEXITCODE -ne 0) { throw '标签创建失败；若标签已存在，请检查其提交后继续，勿强制覆盖。' }
git push origin v0.3.4
if ($LASTEXITCODE -ne 0) { throw '标签推送失败。' }

$assets = @(
  '.\release\installer\WeChatAgent-Setup-0.3.4-x64.exe',
  '.\release\installer\SHA256SUMS.txt',
  '.\release\installer\VERIFICATION.json'
)
foreach ($asset in $assets) {
  if (-not (Test-Path -LiteralPath $asset)) { throw "缺少附件：$asset" }
}
gh release create v0.3.4 @assets --repo sourcepro5/WeChatAgent --verify-tag --title "WeChatAgent 0.3.4" --notes-file RELEASE_NOTES.md --latest
if ($LASTEXITCODE -ne 0) { throw 'Release 发布未完成，请检查网络、登录状态与既有发布。' }
gh release view v0.3.4 --repo sourcepro5/WeChatAgent --web
```

若 Release 已创建而附件上传中断，用 `gh release view v0.3.4 --repo sourcepro5/WeChatAgent` 检查，再用 `gh release upload v0.3.4 <缺少的附件路径> --repo sourcepro5/WeChatAgent` 补传。

state/、release/、node_modules/、实际配置、数据库、凭据及日志已被 Git 忽略；安装包仅作为 Release 附件上传。五份授权人格作为预设保留，开发测试和合成数据不随公开版分发。

官方命令说明：[gh release create](https://cli.github.com/manual/gh_release_create)、[gh release upload](https://cli.github.com/manual/gh_release_upload)。
