; NSIS: installer script with sections, variables, macros.
!define NAME "Native File Editor"
!define LIMIT 5242880
Name "${NAME}"
OutFile "nfe-setup.exe"
InstallDir "$PROGRAMFILES\${NAME}"
RequestExecutionLevel user

Var VaultPath

Section "Plugin" SecPlugin
  SetOutPath "$INSTDIR"
  File "native-file-editor\main.js"
  File "native-file-editor\manifest.json"
  File "native-file-editor\styles.css"
  StrCpy $VaultPath "$DOCUMENTS\Vault"
  ${If} ${FileExists} "$VaultPath\.obsidian"
    DetailPrint "Vault found at $VaultPath"
  ${EndIf}
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\*.*"
  RMDir "$INSTDIR"
SectionEnd
