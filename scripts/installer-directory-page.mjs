// Keep the stock directory page (including its disk-space checks), but let
// its edit control select the root independently from the actual app path.
export function singleDirectoryTemplate(source) {
  const page = '    !insertmacro MUI_PAGE_DIRECTORY';
  const prepare = /    Function instFilesPre[\s\S]*?    FunctionEnd/;
  if (source.split(page).length !== 2 || !prepare.test(source)) {
    throw new Error('NSIS directory page template differs; inspect before building.');
  }
  const settings = [
    '    !define MUI_DIRECTORYPAGE_VARIABLE $WcaRoot',
    '    !define MUI_PAGE_CUSTOMFUNCTION_LEAVE WcaStorageLeave',
    '    !define MUI_DIRECTORYPAGE_TEXT_TOP "只需选择一个安装文件夹。程序放入 app，配置、人设、表情包、日志、缓存和运行环境放入 data。相同位置升级沿用已有数据目录；检测到旧数据时，首次启动会确认迁移。"',
    '    !define MUI_DIRECTORYPAGE_TEXT_DESTINATION "安装根目录"',
    page,
  ].join('\n');
  return source
    .replace('    !include StrContains.nsh', '    # The app/data layout is selected by installer-storage.nsh.')
    .replace(page, () => settings)
    .replace(prepare, () => '    Function instFilesPre\n      Call WcaStoragePreInstall\n    FunctionEnd');
}
