# publish-pages.ps1 - build index.html (RU Asset Database online view) and push it to GitHub Pages.
# Usage (from the repo/project folder):
#   powershell -ExecutionPolicy Bypass -File scripts\publish-pages.ps1                 # editable version, rebuild from DB
#   powershell -ExecutionPolicy Bypass -File scripts\publish-pages.ps1 -ReadOnly       # locked read-only version
#   powershell -ExecutionPolicy Bypass -File scripts\publish-pages.ps1 -Db D:\x\finance_assets.db
#   powershell -ExecutionPolicy Bypass -File scripts\publish-pages.ps1 -NoExport       # push the index.html already in the folder
# Layouts: (a) RU_Asset_View repo (scripts\ next to index.html, .git here) -> builds/pushes in this folder
#          (b) ru-asset-database project (server\data\finance_assets.db) -> builds into pages-export\ and pushes from there
# Requires: node 22.5+ (node:sqlite) unless -NoExport, git, gh (logged in: gh auth status)
# This file is ASCII-only on purpose (Windows PowerShell 5.1 reads BOM-less files as ANSI).
param([string]$Repo = 'pakonkook-glitch/RU_Asset_View', [switch]$ReadOnly, [string]$Db = '', [switch]$NoExport)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$repoMode = (Test-Path (Join-Path $project '.git')) -and -not (Test-Path (Join-Path $project 'server'))
$work = if ($repoMode) { $project } else { Join-Path $project 'pages-export' }
$out = Join-Path $work 'index.html'
if (-not $Db) { $Db = Join-Path $project 'server\data\finance_assets.db' }

if (-not $NoExport) {
  if (-not (Test-Path $Db)) { throw "Database not found: $Db  (use -Db <path> or -NoExport to push the existing index.html)" }
  $exportArgs = @((Join-Path $PSScriptRoot 'export-pages.mjs'), '--db', $Db, '--out', $out)
  if ($ReadOnly) { $exportArgs += '--readonly' }
  node --no-warnings @exportArgs
  if ($LASTEXITCODE -ne 0) { throw 'export failed' }
} elseif (-not (Test-Path $out)) { throw "No index.html at $out" }

# Privacy guard (export-pages.mjs checks too): refuse to publish if forbidden words / field names appear
$html = [IO.File]::ReadAllText($out, [Text.Encoding]::UTF8)
$thai = @(([string][char]0x0E19 + [char]0x0E32 + [char]0x0E22), ([string][char]0x0E19 + [char]0x0E32 + [char]0x0E07), ([string][char]0x0E1A + [char]0x0E32 + [char]0x0E17))
foreach ($bad in @('user_name','user_note','unit_price','total_value','net_value','depreciation','remarks','extra_notes','image_url','"price"') + $thai) {
  if ($html.Contains($bad)) { throw "Privacy check failed: found a forbidden string in index.html" }
}
Write-Host 'Privacy check OK'
$isRO = $html.Contains('(' + [char]0x0E2D + [char]0x0E48 + [char]0x0E32 + [char]0x0E19)  # title contains "(read" in Thai -> read-only build
Write-Host ("Version: " + $(if ($isRO) { 'READ-ONLY' } else { 'EDITABLE' }))

Push-Location $work
try {
  if (-not (Test-Path '.git')) {
    git init -b main | Out-Null
    gh repo view $Repo *> $null
    if ($LASTEXITCODE -ne 0) { gh repo create $Repo --public --description 'RU asset register online view' | Out-Null }
    git remote add origin "https://github.com/$Repo.git"
  }
  if (-not (Test-Path '.gitignore')) { Set-Content -Path '.gitignore' -Value @('*.bak*', 'pages-export/') -Encoding ASCII }
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  git add index.html .gitignore 2>&1 | Out-Null
  if ($repoMode) { git add scripts 2>&1 | Out-Null }
  $ErrorActionPreference = $prev
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    git -c user.name='pakonkook-glitch' -c user.email='pakonkook-glitch@users.noreply.github.com' commit -m ("update RU Asset View " + (Get-Date -Format 'yyyy-MM-dd HH:mm') + $(if ($isRO) { ' (read-only)' } else { ' (editable)' })) 2>&1 | Out-Null
    $ErrorActionPreference = $prev
  } else { Write-Host 'Nothing new to commit' }
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  git push -u origin main 2>&1 | ForEach-Object { "$_" }
  $pushCode = $LASTEXITCODE; $ErrorActionPreference = $prev
  if ($pushCode -ne 0) { throw 'git push failed' }
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { gh api -X POST "repos/$Repo/pages" -f 'source[branch]=main' -f 'source[path]=/' 2>&1 | Out-Null } catch { }  # 409 = already enabled
  $ErrorActionPreference = $prev
  $owner, $name = $Repo.Split('/')
  $url = "https://$owner.github.io/$name/"
  Write-Host "Pages: $url"
  $sha = (git rev-parse --short HEAD)
  Write-Host "Commit: $sha"
} finally { Pop-Location }
