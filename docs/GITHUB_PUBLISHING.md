# GitHub 发布步骤

本目录为 WeChatAgent 0.3.2 公开源码工作树，对应 sourcepro5/WeChatAgent 的 main 分支。本次重新打包覆盖 0.3.2；已有 v0.3.2 标签保留，Release 的同名附件与说明更新。源码与 Release 附件分别上传。

## 登录

在此公开源码目录打开 PowerShell。首次使用 GitHub CLI 时执行：

```powershell
gh auth login
gh auth setup-git
```

## 上传源码

```powershell
npm run privacy:check
if ($LASTEXITCODE -ne 0) { throw '隐私检查未通过，请先修正再上传。' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw '差异检查未通过。' }
git add .
if ($LASTEXITCODE -ne 0) { throw '暂存失败。' }
git diff --cached --stat
git commit -m "Release WeChatAgent 0.3.2"
if ($LASTEXITCODE -ne 0) { throw '提交未完成，请检查 Git 输出。' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw '源码推送未完成，请检查远程分支或登录状态。' }
```

## 上传 Release

先把对应 0.3.2 的安装器、SHA256SUMS.txt 和 VERIFICATION.json 放在本目录的 release/installer/。此目录已被 Git 忽略，附件只通过 Release 上传。

```powershell
$assets = @(
  '.\release\installer\WeChatAgent-Setup-0.3.2-x64.exe',
  '.\release\installer\SHA256SUMS.txt',
  '.\release\installer\VERIFICATION.json'
)
foreach ($asset in $assets) {
  if (-not (Test-Path -LiteralPath $asset)) { throw "缺少附件：$asset" }
}
gh release view v0.3.2 --repo sourcepro5/WeChatAgent *> $null
if ($LASTEXITCODE -eq 0) {
  gh release upload v0.3.2 @assets --repo sourcepro5/WeChatAgent --clobber
  if ($LASTEXITCODE -ne 0) { throw '附件替换失败。' }
  gh release edit v0.3.2 --repo sourcepro5/WeChatAgent --title "WeChatAgent 0.3.2" --notes-file RELEASE_NOTES.md
  if ($LASTEXITCODE -ne 0) { throw '发布说明更新失败。' }
} else {
  gh release create v0.3.2 @assets --repo sourcepro5/WeChatAgent --target main --title "WeChatAgent 0.3.2" --notes-file RELEASE_NOTES.md
  if ($LASTEXITCODE -ne 0) { throw 'Release 创建失败，请检查网络、登录状态或既有发布。' }
}
gh release view v0.3.2 --repo sourcepro5/WeChatAgent --web
```

若 Release 创建成功但附件上传中断，使用 gh release view 检查缺少的附件，再用 gh release upload v0.3.2 <缺少的附件路径> --repo sourcepro5/WeChatAgent 补传。本次按要求使用 --clobber 替换同名附件。已有标签仍指向原提交，最新修复源码在 main；不强制改写已发布标签。

不要将 state/、release/、node_modules/、实际配置、数据库、凭据或日志提交到 Git。五份授权人格作为公开预设保留；开发测试与合成数据不随公开版分发。源码检查针对候选提交文件，不替代其他电脑与真实账号的功能验证。

官方命令说明：[gh release create](https://cli.github.com/manual/gh_release_create)、[gh release upload](https://cli.github.com/manual/gh_release_upload)。
