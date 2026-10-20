!ifndef BUILD_UNINSTALLER
!define /ifndef INSTALL_REGISTRY_KEY "Software\${APP_GUID}"
!include MUI2.nsh
!insertmacro MUI_DIRECTORYPAGE_INTERFACE
!include LogicLib.nsh
!include FileFunc.nsh

Var WcaDataHome
Var WcaMigrationSource
Var WcaRoot
Var WcaProgram
Var WcaPreviousProgram
Var WcaRememberedDataHome
Var WcaStorageError
Var WcaMigrate

!macro customInit
  ReadRegStr $WcaPreviousProgram HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ReadRegStr $WcaDataHome HKCU "Software\WeChatAgent" "DataHome"
  ReadINIStr $1 "$WcaPreviousProgram\storage.ini" "Storage" "dataHome"
  ${If} $1 != ""
    StrCpy $WcaDataHome $1
  ${EndIf}
  ReadINIStr $1 "$INSTDIR\storage.ini" "Storage" "dataHome"
  ${If} $1 != ""
    StrCpy $WcaDataHome $1
  ${EndIf}
  StrCpy $WcaMigrationSource $WcaDataHome
  ${If} $WcaMigrationSource == ""
    StrCpy $WcaMigrationSource "$APPDATA\WeChatAgent"
  ${EndIf}
  ${IfNot} ${FileExists} "$WcaMigrationSource\workspace\config\wechatagent.json"
    ReadINIStr $1 "$INSTDIR\storage.ini" "Storage" "migrationSource"
    ${If} $1 == ""
      ReadINIStr $1 "$WcaPreviousProgram\storage.ini" "Storage" "migrationSource"
    ${EndIf}
    ${If} $1 != ""
      StrCpy $WcaMigrationSource $1
    ${Else}
      StrCpy $WcaMigrationSource "$APPDATA\WeChatAgent"
    ${EndIf}
  ${EndIf}
  # Refuse a legacy layout whose own uninstaller would delete the source.
  ${If} ${FileExists} "$WcaMigrationSource\workspace\config\wechatagent.json"
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $0 != ""
      StrCpy $0 "$0\"
      StrLen $1 $0
      StrCpy $2 "$WcaMigrationSource\" $1
      ${If} $0 == $2
        MessageBox MB_ICONSTOP "旧版数据位于旧程序目录内，请先备份到程序目录之外，再继续安装。"
        SetErrorLevel 2
        Quit
      ${EndIf}
    ${EndIf}
  ${EndIf}
  StrCpy $WcaMigrate "1"
  StrCpy $WcaRememberedDataHome $WcaDataHome
  # The only directory page edits WcaRoot, never the app directory.
  StrCpy $WcaRoot $INSTDIR
  ReadINIStr $0 "$INSTDIR\storage.ini" "Storage" "layoutVersion"
  ${If} $0 == "1"
    ${GetParent} "$INSTDIR" $WcaRoot
  ${ElseIf} $INSTDIR == $WcaPreviousProgram
  ${AndIf} $WcaRememberedDataHome != ""
    ${GetFileName} "$INSTDIR" $0
    ${If} $0 == "app"
      ${GetParent} "$INSTDIR" $WcaRoot
    ${EndIf}
  ${EndIf}
  ${If} ${Silent}
    Call WcaStoragePreInstall
  ${EndIf}
  ClearErrors
!macroend

Function WcaNormalizeDirectory
  Exch $0
  Push $1
  Push $2
  # Unlike NSIS GetFullPathName, this also resolves not-yet-created folders.
  System::Call 'kernel32::GetFullPathNameW(w r0, i ${NSIS_MAX_STRLEN}, w .r1, p 0)i.r2'
  ${If} $2 == 0
  ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
    StrCpy $0 ""
  ${Else}
    StrCpy $0 $1
    ${GetRoot} "$0" $1
    ${If} $0 != $1
    ${AndIf} $0 != "$1\"
      wca_trim_separator:
      StrCpy $2 $0 1 -1
      ${If} $2 == "\"
        StrCpy $0 $0 -1
        Goto wca_trim_separator
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
  Exch $0
FunctionEnd

Function WcaSelectStoragePaths
  Push "$WcaRoot"
  Call WcaNormalizeDirectory
  Pop $WcaRoot
  StrCpy $WcaProgram "$WcaRoot\app"
  # Reinstalling a known app preserves its separately selected data path.
  # A different root always starts with that root's own data directory.
  ReadINIStr $0 "$WcaProgram\storage.ini" "Storage" "dataHome"
  ${If} $0 != ""
    StrCpy $WcaDataHome $0
  ${ElseIf} $WcaProgram == $WcaPreviousProgram
  ${AndIf} $WcaRememberedDataHome != ""
    StrCpy $WcaDataHome $WcaRememberedDataHome
  ${Else}
    StrCpy $WcaDataHome "$WcaRoot\data"
  ${EndIf}
FunctionEnd

Function WcaStorageLeave
  # NSIS commits DirVar after this callback; read the current edit control.
  StrCpy $0 $mui.DirectoryPage.Directory
  System::Call 'user32::GetWindowTextW(p r0, w .r1, i ${NSIS_MAX_STRLEN})i.r2'
  StrCpy $WcaRoot $1
  Call WcaPrepareStorage
  ${If} $WcaStorageError != ""
    MessageBox MB_ICONEXCLAMATION "$WcaStorageError"
    Abort
  ${EndIf}
FunctionEnd

Function WcaStoragePreInstall
  Call WcaPrepareStorage
  ${If} $WcaStorageError != ""
    MessageBox MB_ICONSTOP "$WcaStorageError" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd

Function WcaPrepareStorage
  StrCpy $WcaStorageError ""
  ${If} $WcaRoot == ""
    StrCpy $WcaStorageError "请选择安装文件夹。"
    Return
  ${EndIf}
  Call WcaSelectStoragePaths
  ${GetRoot} "$WcaRoot" $0
  ${If} $WcaRoot == $0
  ${OrIf} $WcaRoot == "$0\"
    StrCpy $WcaStorageError "请选择一个安装文件夹，不能直接使用磁盘根目录。"
    Return
  ${EndIf}
  Push "$WcaDataHome"
  Call WcaNormalizeDirectory
  Pop $WcaDataHome
  ${GetRoot} "$WcaDataHome" $0
  ${If} $WcaDataHome == $0
  ${OrIf} $WcaDataHome == "$0\"
    StrCpy $WcaStorageError "旧版数据位置不能是磁盘根目录，请先备份到独立文件夹。"
    Return
  ${EndIf}
  # Compare case-insensitively, including a trailing separator boundary.
  StrCpy $0 "$WcaProgram\"
  StrCpy $1 "$WcaDataHome\"
  StrLen $2 $0
  StrCpy $3 $1 $2
  ${If} $3 == $0
    StrCpy $WcaStorageError "数据不能放在 app 程序目录中，否则卸载时可能被删除。"
    Return
  ${EndIf}
  ${If} $WcaMigrate == "1"
  ${AndIf} $WcaDataHome != $WcaMigrationSource
    StrCpy $0 "$WcaMigrationSource\"
    StrLen $2 $0
    StrCpy $3 $1 $2
    ${If} $3 == $0
      StrCpy $WcaStorageError "新旧数据目录不能互相包含，请选择旧目录之外的安装位置。"
      Return
    ${EndIf}
    StrLen $2 $1
    StrCpy $3 $0 $2
    ${If} $3 == $1
      StrCpy $WcaStorageError "新旧数据目录不能互相包含，请选择旧目录之外的安装位置。"
      Return
    ${EndIf}
  ${EndIf}
  StrCpy $0 "$WcaProgram\"
  StrLen $2 $1
  StrCpy $3 $0 $2
  ${If} $3 == $1
    StrCpy $WcaStorageError "程序目录与数据目录不能互相包含。"
    Return
  ${EndIf}
  # Existing data under a legacy install directory would be deleted by its
  # old uninstaller before extraction. Refuse that target; never move it here.
  ${If} ${FileExists} "$WcaDataHome\workspace\config\wechatagent.json"
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $0 != ""
      StrCpy $0 "$0\"
      StrLen $2 $0
      StrCpy $3 $1 $2
      ${If} $3 == $0
        StrCpy $WcaStorageError "该数据位于旧程序目录内，旧版卸载可能删除它。请先备份并选择程序目录外的位置。"
        Return
      ${EndIf}
    ${EndIf}
  ${EndIf}
  # Probe writability before uninstalling anything; leave no test file behind.
  StrCpy $4 "0"
  ${IfNot} ${FileExists} "$WcaDataHome\*.*"
    StrCpy $4 "1"
  ${EndIf}
  ClearErrors
  CreateDirectory "$WcaDataHome"
  GetTempFileName $5 "$WcaDataHome"
  ${If} ${Errors}
    StrCpy $WcaStorageError "无法写入数据目录，请选择当前用户可写的安装位置。"
    Return
  ${EndIf}
  Delete "$5"
  ${If} $4 == "1"
    RMDir "$WcaDataHome"
  ${EndIf}
  StrCpy $INSTDIR $WcaProgram
FunctionEnd

!macro customInstall
  # Force Unicode INI output; an ANSI INI would corrupt Chinese paths.
  ClearErrors
  FileOpen $0 "$INSTDIR\storage.ini" w
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "无法保存数据位置，安装未完成。请检查程序目录权限。"
    Abort
  ${EndIf}
  FileWriteUTF16LE /BOM $0 "[Storage]$\r$\n"
  FileClose $0
  WriteINIStr "$INSTDIR\storage.ini" "Storage" "layoutVersion" "1"
  WriteINIStr "$INSTDIR\storage.ini" "Storage" "dataHome" "$WcaDataHome"
  ${If} $WcaMigrate == "1"
    WriteINIStr "$INSTDIR\storage.ini" "Storage" "migrationSource" "$WcaMigrationSource"
  ${Else}
    WriteINIStr "$INSTDIR\storage.ini" "Storage" "migrationSource" ""
  ${EndIf}
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "无法保存数据位置，安装未完成。原数据未删除。"
    Abort
  ${EndIf}
  WriteRegStr HKCU "Software\WeChatAgent" "DataHome" "$WcaDataHome"
!macroend
!endif
