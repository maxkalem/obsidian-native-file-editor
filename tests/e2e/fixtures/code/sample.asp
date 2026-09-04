<%@ Language="VBScript" %>
<% Option Explicit
   ' Classic ASP: server-side VBScript mixed with HTML.
   Const LIMIT = 5242880
   Dim path, size
   path = Request.QueryString("path")
   size = CLng(Request.QueryString("size"))
%>
<!DOCTYPE html>
<html>
<body>
  <h1>Note <%= Server.HTMLEncode(path) %></h1>
  <% If size > LIMIT Then %>
    <p class="warn">Opens as preview (<%= size %> bytes).</p>
  <% Else %>
    <p>Opens in the editor.</p>
  <% End If %>
</body>
</html>
