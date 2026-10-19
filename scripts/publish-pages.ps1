# publish-pages.ps1 — regenerate index.html from the DB (read-only) and push to GitHub Pages.
# Usage (from the project folder):  powershell -ExecutionPolicy Bypass -File scripts\publish-pages.ps1
# Requires: node (with node:sqlite), git, gh (logged in: gh auth status)
param([string]$Repo = 'pakonkook-glitch/RU_Asset_View')
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$work = Join-Path $project 'pages-export'

node --no-warnings (Join-Path $PSScriptRoot 'export-pages.mjs') --out (Join-Path $work 'index.html')
if ($LASTEXITCODE -ne 0) { throw 'export failed' }

# Privacy guard: refuse to publish if forbidden field names appear in the HTML
$html = Get-Content (Join-Path $work 'index.html') -Raw -Encoding UTF8
foreach ($bad in 'user_name','user_note','unit_price','total_value','net_value','depreciation','remarks','extra_notes','image_url','"price"','นาย','นาง','บาท') {
  if ($html.Contains($bad)) { throw "Privacy check failed: found '$bad' in index.html" }
}

Push-Location $work
try {
  if (-not (Test-Path '.git')) {
    git init -b main | Out-Null
    $exists = $true; gh repo view $Repo *> $null; if ($LASTEXITCODE -ne 0) { $exists = $false }
    if (-not $exists) { gh repo create $Repo --public --description 'RU asset register - read-only view' | Out-Null }
    git remote add origin "https://github.com/$Repo.git"
  }
  git add index.html
  git commit -m ("update data " + (Get-Date -Format 'yyyy-MM-dd HH:mm')) | Out-Null
  git push -u origin main
  # enable Pages (main / root); ignore error if already enabled
  gh api -X POST "repos/$Repo/pages" -f 'source[branch]=main' -f 'source[path]=/' 2>$null | Out-Null
  $owner, $name = $Repo.Split('/')
  Write-Host "Pages: https://$owner.github.io/$name/"
} finally { Pop-Location }
