' VBScript: Dim, functions, FileSystemObject, string concatenation.
Option Explicit

Const LIMIT = 5242880
Dim fso, vault, dst, f
Set fso = CreateObject("Scripting.FileSystemObject")

vault = "C:\Vault"
If WScript.Arguments.Count > 0 Then vault = WScript.Arguments(0)
dst = vault & "\.obsidian\plugins\native-file-editor"

If Not fso.FolderExists(dst) Then fso.CreateFolder dst

For Each f In Array("main.js", "manifest.json", "styles.css")
    fso.CopyFile "native-file-editor\" & f, dst & "\" & f, True
Next

Function IsLarge(size)
    IsLarge = (size > LIMIT)
End Function

WScript.Echo "copied to " & dst & " (" & CStr(IsLarge(6291456)) & ")"
