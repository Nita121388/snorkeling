; Copyright 2026, Command Line Inc.
; SPDX-License-Identifier: Apache-2.0
;
; NSIS script fragment included by electron-builder for the Snorkeling installer.
; Registers the "Open with Snorkeling" entry on the Explorer folder context menu.
; Uses electron-builder's customInstall / customUnInstall macro hooks.

!macro customInstall
  ; Folder context menu: right-click a folder -> "Open with Snorkeling"
  WriteRegStr HKCR "Directory\shell\Snorkeling" "" "Open with Snorkeling"
  WriteRegStr HKCR "Directory\shell\Snorkeling" "Icon" "$INSTDIR\Snorkeling.exe,0"
  WriteRegStr HKCR "Directory\shell\Snorkeling\command" "" '"$INSTDIR\Snorkeling.exe" "%V"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCR "Directory\shell\Snorkeling"
!macroend
