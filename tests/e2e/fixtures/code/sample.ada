-- Ada
with Ada.Text_IO; use Ada.Text_IO;
procedure Hello is
   Count : Integer := 3;
begin
   Put_Line ("Hello " & Integer'Image (Count));
end Hello;
