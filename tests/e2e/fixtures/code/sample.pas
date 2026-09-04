program Scanner;
{ Pascal: records, procedures, arrays, string handling. }
{$mode objfpc}{$H+}

uses SysUtils;

const
  Limit = 5 * 1024 * 1024;

type
  TNote = record
    Path: string;
    Size: Int64;
  end;
  TNotes = array of TNote;

function CountLarge(const Notes: TNotes): Integer;
var
  I: Integer;
begin
  Result := 0;
  for I := Low(Notes) to High(Notes) do
    if Notes[I].Size > Limit then
      Inc(Result);
end;

var
  Notes: TNotes;
begin
  SetLength(Notes, 2);
  Notes[0].Path := 'a.md'; Notes[0].Size := 12;
  Notes[1].Path := 'b.md'; Notes[1].Size := 6291456;
  WriteLn(Format('large: %d', [CountLarge(Notes)]));
end.
