import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { singleDirectoryTemplate } from './installer-directory-page.mjs';
import storage from '../apps/console-desktop/storage-location.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nsisName = 'nsis-3.0.4.1-nsis-3.0.4.1';
const caches = [root, path.join(path.dirname(root), 'WeChatAgent')];
const compiler = caches.map(base => path.join(base, 'state/installer-cache/electron-builder/nsis', nsisName, 'makensis.exe')).find(file => fs.existsSync(file));
const templates = [path.join(root, 'node_modules/app-builder-lib/templates/nsis'), path.join(root, 'components/WeFlowComplete/node_modules/app-builder-lib/templates/nsis')];
const templateFile = templates.map(base => path.join(base, 'assistedInstaller.nsh')).find(file => fs.existsSync(file));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const ini = (section, values) => '[' + section + ']\r\n' + Object.entries(values).map(([key, value]) => key + '=' + value).join('\r\n') + '\r\n';
const readIni = file => Object.fromEntries(fs.readFileSync(file, 'utf16le').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.includes('=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const quoteNsis = text => text.replaceAll('$', '$$').replaceAll('"', '$\\"');

test('the installer has one native root selector and validates before uninstalling', () => {
  const example = '    !include StrContains.nsh\n    !insertmacro MUI_PAGE_DIRECTORY\n    Function instFilesPre\n      legacy\n    FunctionEnd';
  const output = singleDirectoryTemplate(example);
  assert.equal(output.split('!insertmacro MUI_PAGE_DIRECTORY').length, 2);
  assert.match(output, /MUI_DIRECTORYPAGE_VARIABLE \$WcaRoot/);
  assert.match(output, /MUI_PAGE_CUSTOMFUNCTION_LEAVE WcaStorageLeave/);
  assert.match(output, /Function instFilesPre\s+Call WcaStoragePreInstall/);
  assert(!output.includes('legacy'));
  assert.throws(() => singleDirectoryTemplate(example + '\n    !insertmacro MUI_PAGE_DIRECTORY'), /template differs/);
  const include = fs.readFileSync(path.join(root, 'apps/console-desktop/installer-storage.nsh'), 'utf8');
  assert(!/Page custom|CreateDirRequest|SelectFolderDialog|WcaStoragePage/.test(include));
  assert.match(include, /StrCpy \$0 \$mui\.DirectoryPage\.Directory\s+System::Call 'user32::GetWindowTextW/);
  assert.match(fs.readFileSync(path.join(root, 'scripts/build-installer.mjs'), 'utf8'), /singleDirectoryTemplate\(assisted\)/);
});

test('compiled NSIS storage selection preserves upgrades and derives both folders from one root', {
  skip: process.platform !== 'win32' || !compiler || !templateFile ? 'Windows and the cached NSIS compiler/build dependencies are required' : false,
}, async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wca-one-directory-'));
  const id = crypto.randomUUID();
  // Only this disposable registry subtree is read/written by the fixture.
  const registry = 'Software\\WeChatAgent-Installer-Test\\' + id;
  const fixtureInclude = path.join(base, 'installer-storage.nsh');
  const failureFile = path.join(base, 'failure.ini');
  const include = fs.readFileSync(path.join(root, 'apps/console-desktop/installer-storage.nsh'), 'utf8')
    .replaceAll('Software\\WeChatAgent', registry)
    .replaceAll('$APPDATA\\WeChatAgent', quoteNsis(path.join(base, 'legacy')))
    .replace('    MessageBox MB_ICONEXCLAMATION "$WcaStorageError"', () => `    FileOpen $0 "${quoteNsis(failureFile)}" w\n    FileWriteUTF16LE /BOM $0 "[Failure]$\\r$\\nerror=$WcaStorageError$\\r$\\nroot=$WcaRoot$\\r$\\n"\n    FileClose $0\n    SetErrorLevel 2\n    Quit`)
    .replace('    MessageBox MB_ICONSTOP "$WcaStorageError" /SD IDOK', () => `    FileOpen $0 "${quoteNsis(failureFile)}" w\n    FileWriteUTF16LE /BOM $0 "[Failure]$\\r$\\nerror=$WcaStorageError$\\r$\\nroot=$WcaRoot$\\r$\\ndata=$WcaDataHome$\\r$\\nsource=$WcaMigrationSource$\\r$\\n"\n    FileClose $0`);
  write(fixtureInclude, include);
  const actualTemplate = singleDirectoryTemplate(fs.readFileSync(templateFile, 'utf8'));
  const page = actualTemplate.match(/    !define MUI_DIRECTORYPAGE_VARIABLE[\s\S]*?    !insertmacro MUI_PAGE_DIRECTORY/)[0];
  const preInstall = actualTemplate.match(/    Function instFilesPre[\s\S]*?    FunctionEnd/)[0];
  const exe = path.join(base, 'probe.exe');
  t.after(() => {
    if (!fs.existsSync(base)) return;
    if (fs.existsSync(exe)) spawnSync(exe, ['/S', '/cleanup'], { windowsHide: true, timeout: 15000 });
    assert(base.startsWith(os.tmpdir() + path.sep));
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const outputFile = path.join(base, 'result.ini');
  const inputFile = path.join(base, 'input.ini');
  const script = `
Unicode true
Name "WeChatAgent directory selection fixture"
OutFile "${quoteNsis(exe)}"
RequestExecutionLevel user
Var ProbeEdit
!define APP_GUID "WeChatAgent-Installer-Test\\${id}\\Install"
!include "${quoteNsis(fixtureInclude)}"
${page}
!define MUI_PAGE_CUSTOMFUNCTION_PRE instFilesPre
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
${preInstall}
Function .onInit
  SetRegView 64
  \${GetParameters} $R0
  \${GetOptions} $R0 "/cleanup" $R1
  \${IfNot} \${Errors}
    DeleteRegKey HKCU "${quoteNsis(registry)}"
    Quit
  \${EndIf}
  DeleteRegKey HKCU "${quoteNsis(registry)}"
  ReadINIStr $0 "${quoteNsis(inputFile)}" "Case" "previousProgram"
  WriteRegStr HKCU "\${INSTALL_REGISTRY_KEY}" "InstallLocation" "$0"
  ReadINIStr $0 "${quoteNsis(inputFile)}" "Case" "rememberedData"
  ClearErrors
  WriteRegStr HKCU "${quoteNsis(registry)}" "DataHome" "$0"
  \${If} \${Errors}
    SetErrorLevel 3
    Quit
  \${EndIf}
  ReadINIStr $INSTDIR "${quoteNsis(inputFile)}" "Case" "initialDirectory"
  !insertmacro customInit
FunctionEnd
Section
  ReadINIStr $0 "${quoteNsis(inputFile)}" "Case" "selectedRoot"
  \${If} $0 != ""
    ReadINIStr $1 "${quoteNsis(inputFile)}" "Case" "useControl"
    \${If} $1 == "1"
      System::Call 'user32::CreateWindowExW(i 0, w "EDIT", w r0, i 0, i 0, i 0, i 200, i 20, p 0, p 0, p 0, p 0)p.s'
      Pop $ProbeEdit
      ReadINIStr $2 "${quoteNsis(inputFile)}" "Case" "selectedRoot"
      SendMessage $ProbeEdit \${WM_SETTEXT} 0 "STR:$2"
      StrCpy $mui.DirectoryPage.Directory $ProbeEdit
      Call WcaStorageLeave
      System::Call 'user32::DestroyWindow(p $ProbeEdit)'
    \${Else}
      StrCpy $WcaRoot $0
      Call WcaPrepareStorage
    \${EndIf}
  \${EndIf}
  ReadINIStr $0 "${quoteNsis(inputFile)}" "Case" "secondRoot"
  \${If} $0 != ""
    StrCpy $WcaRoot $0
    Call WcaPrepareStorage
  \${EndIf}
  FileOpen $0 "${quoteNsis(outputFile)}" w
  FileWriteUTF16LE /BOM $0 "[Result]$\\r$\\n"
  FileClose $0
  WriteINIStr "${quoteNsis(outputFile)}" "Result" "root" "$WcaRoot"
  WriteINIStr "${quoteNsis(outputFile)}" "Result" "program" "$INSTDIR"
  WriteINIStr "${quoteNsis(outputFile)}" "Result" "data" "$WcaDataHome"
  WriteINIStr "${quoteNsis(outputFile)}" "Result" "source" "$WcaMigrationSource"
  WriteINIStr "${quoteNsis(outputFile)}" "Result" "error" "$WcaStorageError"
  \${If} $WcaStorageError == ""
    CreateDirectory "$INSTDIR"
    !insertmacro customInstall
  \${EndIf}
  DeleteRegKey HKCU "${quoteNsis(registry)}"
SectionEnd
`;
  const file = path.join(base, 'probe.nsi');
  write(file, script);
  const compiled = spawnSync(compiler, ['/V2', '/INPUTCHARSET', 'UTF8', file], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  assert.doesNotMatch(compiled.stdout + compiled.stderr, /unknown variable\/constant/i);
  function run(name, values = {}, setup = () => {}) {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    setup(dir);
    const initial = path.join(dir, 'selected');
    write(inputFile, Buffer.from('\uFEFF' + ini('Case', { previousProgram: '', rememberedData: '', selectedRoot: '', secondRoot: '', useControl: '0', initialDirectory: initial, ...values }), 'utf16le'));
    fs.rmSync(outputFile, { force: true });
    fs.rmSync(failureFile, { force: true });
    const result = spawnSync(exe, ['/S'], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, fs.existsSync(failureFile) ? JSON.stringify(readIni(failureFile)) : result.error?.message || result.stdout + result.stderr);
    return readIni(outputFile);
  }
  try {
    await t.test('fresh Unicode path: app and data are siblings and storage.ini resolves to data', () => {
      const selected = path.join(base, '用户选择 安装目录');
      const result = run('fresh', { selectedRoot: selected });
      assert.equal(result.program, path.join(selected, 'app'));
      assert.equal(result.data, path.join(selected, 'data'));
      assert.equal(result.error, '');
      assert.equal(storage.resolveStorageLocation({ appDir: result.program }).dataHome, result.data);
    });
    await t.test('silent installation derives app/data without displaying a directory page', () => {
      const result = run('silent');
      assert.equal(result.root, path.join(base, 'silent/selected'));
      assert.equal(result.program, path.join(result.root, 'app'));
      assert.equal(result.data, path.join(result.root, 'data'));
    });
    await t.test('the directory leave callback reads the current edit value instead of the old root', () => {
      const selected = path.join(base, 'typed root');
      const result = run('edit-control', { selectedRoot: selected + path.sep, useControl: '1' });
      assert.equal(result.root, selected); assert.equal(result.program, path.join(selected, 'app')); assert.equal(result.data, path.join(selected, 'data'));
    });
    await t.test('same-location upgrade preserves an old separate data path without app/app', () => {
      const selected = path.join(base, 'upgrade'), program = path.join(selected, 'app'), data = path.join(base, 'old separate data');
      const result = run('upgrade', { initialDirectory: program, previousProgram: program, rememberedData: path.join(base, 'stale-registry') }, () => {
        write(path.join(program, 'storage.ini'), ini('Storage', { layoutVersion: '1', dataHome: data, migrationSource: '' }));
        write(path.join(data, 'workspace/config/wechatagent.json'), '{"keep":true}');
      });
      assert.equal(result.root, selected); assert.equal(result.program, program); assert.equal(result.data, data); assert.equal(result.source, data);
      assert.equal(fs.readFileSync(path.join(data, 'workspace/config/wechatagent.json'), 'utf8'), '{"keep":true}');
    });
    await t.test('a different selected root uses its own data and retains the old migration source', () => {
      const previous = path.join(base, 'old-root/app'), oldData = path.join(base, 'old-root/data'), selected = path.join(base, 'new-root');
      const result = run('relocate', { initialDirectory: previous, previousProgram: previous, selectedRoot: selected }, () => {
        write(path.join(previous, 'storage.ini'), ini('Storage', { layoutVersion: '1', dataHome: oldData }));
        write(path.join(oldData, 'workspace/config/wechatagent.json'), '{"keep":true}');
      });
      assert.equal(result.program, path.join(selected, 'app')); assert.equal(result.data, path.join(selected, 'data')); assert.equal(result.source, oldData);
      const resolved = storage.resolveStorageLocation({ appDir: result.program });
      assert.equal(resolved.migrationSource, oldData); assert(storage.migrationPlan(resolved).needed);
      assert.equal(fs.readFileSync(path.join(oldData, 'workspace/config/wechatagent.json'), 'utf8'), '{"keep":true}');
    });
    await t.test('changing the root twice recomputes data rather than retaining the first choice', () => {
      const second = path.join(base, 'back-and-change/second');
      const result = run('back-and-change', { selectedRoot: path.join(base, 'back-and-change/first'), secondRoot: second });
      assert.equal(result.program, path.join(second, 'app')); assert.equal(result.data, path.join(second, 'data'));
    });
    await t.test('same-location registry fallback survives a missing old storage.ini', () => {
      const selected = path.join(base, 'registry-only/selected'), data = path.join(base, 'registry-only/owner-data');
      const result = run('registry-only', { initialDirectory: path.join(selected, 'app'), previousProgram: path.join(selected, 'app'), rememberedData: data });
      assert.equal(result.root, selected); assert.equal(result.program, path.join(selected, 'app')); assert.equal(result.data, data);
    });
    await t.test('an unfinished migration retains the original source across reinstall', () => {
      const program = path.join(base, 'pending/app'), data = path.join(base, 'pending/data'), old = path.join(base, 'pending/source');
      const result = run('pending', { initialDirectory: program, previousProgram: program }, () => {
        write(path.join(program, 'storage.ini'), ini('Storage', { layoutVersion: '1', dataHome: data, migrationSource: old }));
        write(path.join(old, 'workspace/config/wechatagent.json'), '{"keep":true}');
      });
      assert.equal(result.data, data); assert.equal(result.source, old);
      assert.equal(readIni(path.join(program, 'storage.ini')).migrationSource, old);
    });
    await t.test('drive root, contained source, overlapping app data, and unwritable data are refused', () => {
      const drive = run('drive', { selectedRoot: path.parse(base).root }); assert.match(drive.error, /磁盘根目录/);
      const old = path.join(base, 'nested/old-data');
      const nested = run('nested', { rememberedData: old, selectedRoot: path.join(old, 'inside') }, () => write(path.join(old, 'workspace/config/wechatagent.json'), '{"keep":true}'));
      assert.match(nested.error, /互相包含/);
      const selected = path.join(base, 'overlap/selected');
      const overlap = run('overlap', { initialDirectory: path.join(base, 'overlap/before-selection'), selectedRoot: selected }, () => write(path.join(selected, 'app/storage.ini'), ini('Storage', { dataHome: path.join(selected, 'app/data') })));
      assert.match(overlap.error, /app 程序目录/);
      const blocked = path.join(base, 'blocked/target');
      const denied = run('blocked', { selectedRoot: blocked }, () => write(path.join(blocked, 'data'), 'owned file'));
      assert.match(denied.error, /无法写入/); assert.equal(fs.readFileSync(path.join(blocked, 'data'), 'utf8'), 'owned file');
    });
  } finally {
    spawnSync(exe, ['/S', '/cleanup'], { windowsHide: true, timeout: 15000 });
    assert(base.startsWith(os.tmpdir() + path.sep));
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
