Option Explicit
Dim shell, fso, root, python, result
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
python = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\PersonalTap\ai-trend\python-path.txt")
If Not fso.FileExists(python) Then WScript.Quit 2
Dim reader
Set reader = fso.OpenTextFile(python, 1, False, -1)
python = Trim(reader.ReadAll)
reader.Close
result = shell.Run(Chr(34) & python & Chr(34) & " " & Chr(34) & root & "\research-background.py" & Chr(34), 0, True)
WScript.Quit result
