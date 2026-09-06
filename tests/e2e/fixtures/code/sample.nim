# Nim
proc greet(name: string): string =
  result = "Hello, " & name
let count = 3
if count > 2:
  echo greet("big")
