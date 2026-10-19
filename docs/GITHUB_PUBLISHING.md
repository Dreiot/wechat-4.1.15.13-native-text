# GitHub 上传 0.3.8

在公开版仓库目录打开 PowerShell。以下命令提交源码、先合并远端更新，再推送 main 与新标签。遇到 rebase 冲突时先解决并 git rebase --continue，勿继续执行发布命令，勿强推。

```powershell
npm run privacy:check
git add .
git commit -m "Release WeChatAgent 0.3.8"
git fetch origin
git rebase origin/main
git tag v0.3.8
git push --atomic origin main v0.3.8
```

确认 GitHub CLI 已登录后上传完整安装包与校验附件：

```powershell
gh release create v0.3.8 --repo sourcepro5/WeChatAgent --verify-tag --title "WeChatAgent 0.3.8" --notes-file RELEASE_NOTES.md .\release\installer\WeChatAgent-Setup-0.3.8-x64.exe .\release\installer\SHA256SUMS.txt .\release\installer\VERIFICATION.json
```

本版按正常 Release 发布，不标记 Pre-release。源码不会包含 release/、state/、本机配置、令牌或聊天记录。安装器较大，只上传到 Release 附件，不添加进 Git 仓库。
