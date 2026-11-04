; Fail the installation rather than leaving an unusable TX-5DR executable.
; electron-builder's customInstall hook runs after application files are copied.
; The Windows package currently targets x64 only.
!macro customInstall
  IfFileExists "$INSTDIR\resources\bin\win32-x64\node.exe" tx5dr_node_exists tx5dr_node_invalid

tx5dr_node_exists:
  nsExec::ExecToStack '"$INSTDIR\resources\bin\win32-x64\node.exe" --version'
  Pop $0
  Pop $1
  StrCmp $0 "0" tx5dr_node_verified tx5dr_node_invalid

tx5dr_node_invalid:
  DetailPrint "TX-5DR installation aborted: bundled Node executable cannot be launched."
  IfSilent +2
    MessageBox MB_ICONSTOP|MB_OK "TX-5DR installation failed: the bundled Node.js runtime is missing or invalid. Please retry with a verified installer."
  SetErrorLevel 3
  Abort

tx5dr_node_verified:
  DetailPrint "TX-5DR portable Node runtime passed installation self-check."
!macroend
