# Publishes the privacy-safe Lost & Found catalogue to the GitHub Pages viewer.
#   1) export.js : live DB -> data.json + images (whitelisted fields only)
#   2) git commit & push (auth via Git Credential Manager)
# Safe to run on a schedule; exits 0 with "no changes" when nothing moved.
$SITE = 'C:\Users\verdelagoresort\.local\bin\lostfound-web'
$log  = Join-Path $SITE 'publish.log'
function Log($m){ Add-Content -LiteralPath $log ("{0}  {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $m); Write-Output $m }

$summary = & node (Join-Path $SITE 'export.js')
if ($LASTEXITCODE -ne 0) { Log "EXPORT ERROR (exit $LASTEXITCODE): $summary"; exit 1 }
Log "export: $summary"

Set-Location -LiteralPath $SITE
git add -A | Out-Null
if ([string]::IsNullOrWhiteSpace((git status --porcelain))) { Log 'no changes'; exit 0 }

$count = (Get-Content -LiteralPath (Join-Path $SITE 'data.json') -Raw | ConvertFrom-Json).count
$msg = "sync $((Get-Date).ToString('yyyy-MM-dd HH:mm')) - $count artigos"
git commit -q -m $msg | Out-Null
git push -q
if ($LASTEXITCODE -ne 0) { Log "PUSH ERROR (exit $LASTEXITCODE)"; exit 1 }
Log "pushed: $msg"
