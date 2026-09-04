' Visual Basic: modules, classes, properties, LINQ.
Imports System
Imports System.IO
Imports System.Linq

Public Class Note
    Public Const Limit As Long = 5L * 1024 * 1024
    Public Property Path As String
    Public Property Tags As New List(Of String)

    Public ReadOnly Property Size As Long
        Get
            Return New FileInfo(Path).Length
        End Get
    End Property

    Public Function IsLarge() As Boolean
        Return Size > Limit
    End Function
End Class

Module Program
    Sub Main()
        Dim notes = {New Note With {.Path = "a.md"}}
        Dim small = notes.Where(Function(n) Not n.IsLarge()).ToList()
        Console.WriteLine($"{small.Count} small notes at {Date.Now:O}")
    End Sub
End Module
