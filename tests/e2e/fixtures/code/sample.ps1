# PowerShell (legacy stream mode): params, pipeline, hashtable.
param(
    [Parameter(Mandatory = $true)] [string] $Vault,
    [switch] $Clean
)

$dst = Join-Path $Vault ".obsidian\plugins\native-file-editor"
if ($Clean -and (Test-Path $dst)) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dst | Out-Null

$files = @{ "main.js" = 1; "manifest.json" = 2; "styles.css" = 3 }
foreach ($f in $files.Keys | Sort-Object { $files[$_] }) {
    Copy-Item "native-file-editor\$f" $dst -Force
    Write-Host "copied $f"
}
