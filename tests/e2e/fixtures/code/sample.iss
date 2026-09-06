;Inno Setup
[Setup]
AppName=Notes
AppVersion=1.0
[Files]
Source: "notes.exe"; DestDir: "{app}"
[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
