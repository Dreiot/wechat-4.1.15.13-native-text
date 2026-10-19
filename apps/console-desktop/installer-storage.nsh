!ifndef BUILD_UNINSTALLER
!define /ifndef INSTALL_REGISTRY_KEY "Software\${APP_GUID}"
!include nsDialogs.nsh
!include MUI2.nsh
!include LogicLib.nsh
!include FileFunc.nsh

Var WcaDataHome
Var WcaMigrationSource
Var WcaRoot
Var WcaProgram
Var WcaDialog
Var WcaDataInput
Var WcaMigrateCheck
Var WcaMigrate

!macro customInit
  ReadRegStr $WcaDataHome HKCU "Software\WeChatAgent" "DataHome"
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
  # The directory page selects the parent containing app and data.
  ReadINIStr $0 "$INSTDIR\storage.ini" "Storage" "layoutVersion"
  ${If} ${Silent}
    ${If} $0 != "1"
      StrCpy $INSTDIR "$INSTDIR\app"
    ${EndIf}
    ${GetParent} "$INSTDIR" $WcaRoot
    ${If} $WcaDataHome == ""
      StrCpy $WcaDataHome "$WcaRoot\data"
    ${EndIf}
  ${ElseIf} $0 == "1"
    ${GetParent} "$INSTDIR" $INSTDIR
  ${EndIf}
  ClearErrors
!macroend

!macro customPageAfterChangeDir
  Page custom WcaStoragePage WcaStorageLeave
!macroend

Function WcaStoragePage
  StrCpy $WcaRoot $INSTDIR
  ${If} $WcaDataHome == ""
    StrCpy $WcaDataHome "$WcaRoot\data"
  ${EndIf}
  nsDialogs::Create 1018
  Pop $WcaDialog
  ${If} $WcaDialog == error
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "选择数据位置" "程序安装到所选目录的 app 子目录，数据单独保留。"
  ${NSD_CreateLabel} 0 0 100% 24u "账号配置、人设、表情包、聊天状态和运行环境将保存到下面的位置。升级与卸载默认保留这些数据。"
  Pop $0
  ${NSD_CreateDirRequest} 0 32u 78% 14u "$WcaDataHome"
  Pop $WcaDataInput
  ${NSD_CreateBrowseButton} 80% 31u 20% 16u "浏览…"
  Pop $0
  ${NSD_OnClick} $0 WcaStorageBrowse
  ${NSD_CreateCheckbox} 0 58u 100% 16u "首次启动时迁移已有数据，并保留旧副本"
  Pop $WcaMigrateCheck
  ${If} ${FileExists} "$WcaMigrationSource\workspace\config\wechatagent.json"
    ${NSD_Check} $WcaMigrateCheck
  ${Else}
    ${NSD_Uncheck} $WcaMigrateCheck
    EnableWindow $WcaMigrateCheck 0
  ${EndIf}
  ${NSD_CreateLabel} 0 82u 100% 34u "旧数据位置：$WcaMigrationSource$\r$\n迁移在首次启动时进行。请先停止旧版服务，并退出匹配微信和 DSH。目标已有数据时不会合并覆盖。"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function WcaStorageBrowse
  Pop $0
  ${NSD_GetText} $WcaDataInput $WcaDataHome
  nsDialogs::SelectFolderDialog "选择数据目录" "$WcaDataHome"
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $WcaDataInput "$0"
  ${EndIf}
FunctionEnd

Function WcaStorageLeave
  ${NSD_GetText} $WcaDataInput $WcaDataHome
  ${NSD_GetState} $WcaMigrateCheck $WcaMigrate
  ${If} $WcaDataHome == ""
    MessageBox MB_ICONEXCLAMATION "请选择数据目录。"
    Abort
  ${EndIf}
  GetFullPathName $WcaDataHome "$WcaDataHome"
  ${GetRoot} "$WcaDataHome" $0
  ${If} $WcaDataHome == $0
  ${OrIf} $WcaDataHome == "$0\"
    MessageBox MB_ICONEXCLAMATION "请在磁盘中选择一个数据文件夹，不能直接使用磁盘根目录。"
    Abort
  ${EndIf}
  StrCpy $WcaProgram "$WcaRoot\app"
  # Compare case-insensitively, including a trailing separator boundary.
  StrCpy $0 "$WcaProgram\"
  StrCpy $1 "$WcaDataHome\"
  StrLen $2 $0
  StrCpy $3 $1 $2
  ${If} $3 == $0
    MessageBox MB_ICONEXCLAMATION "数据不能放在 app 程序目录中，否则卸载时可能被删除。"
    Abort
  ${EndIf}
  ${If} $WcaMigrate == "1"
  ${AndIf} $WcaDataHome != $WcaMigrationSource
    StrCpy $0 "$WcaMigrationSource\"
    StrLen $2 $0
    StrCpy $3 $1 $2
    ${If} $3 == $0
      MessageBox MB_ICONEXCLAMATION "新旧数据目录不能互相包含，请选择旧目录之外的位置。"
      Abort
    ${EndIf}
    StrLen $2 $1
    StrCpy $3 $0 $2
    ${If} $3 == $1
      MessageBox MB_ICONEXCLAMATION "新旧数据目录不能互相包含，请选择旧目录之外的位置。"
      Abort
    ${EndIf}
  ${EndIf}
  StrCpy $0 "$WcaProgram\"
  StrLen $2 $1
  StrCpy $3 $0 $2
  ${If} $3 == $1
    MessageBox MB_ICONEXCLAMATION "程序目录与数据目录不能互相包含。"
    Abort
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
        MessageBox MB_ICONEXCLAMATION "该数据位于旧程序目录内，旧版卸载可能删除它。请先备份并选择程序目录外的位置。"
        Abort
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
    MessageBox MB_ICONEXCLAMATION "无法写入数据目录，请选择当前用户可写的位置。"
    Abort
  ${EndIf}
  Delete "$5"
  ${If} $4 == "1"
    RMDir "$WcaDataHome"
  ${EndIf}
  StrCpy $INSTDIR $WcaProgram
FunctionEnd

!macro customInstall
  # Silent upgrades reuse the remembered data path and install only app.
  ${If} $WcaRoot == ""
    ${If} $WcaDataHome == ""
      ${GetParent} "$INSTDIR" $WcaRoot
      StrCpy $WcaDataHome "$WcaRoot\data"
    ${EndIf}
  ${EndIf}
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
