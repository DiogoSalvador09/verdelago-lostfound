# Publishes the privacy-safe Lost & Found catalogue to the GitHub Pages viewer.
#   1) export.js : live DB -> data.json + images (whitelisted fields only)
#   2) git commit & push to origin/main (token read from Windows Credential Manager)
# Safe to run UNATTENDED on a schedule: no prompts, exits 0 with "no changes" when idle.
$SITE  = 'C:\Users\verdelagoresort\.local\bin\lostfound-web'
$GIT   = 'C:\Program Files\Git\cmd\git.exe'
$OWNER = 'DiogoSalvador09'; $REPO = 'verdelago-lostfound'
$log   = Join-Path $SITE 'publish.log'
function Log($m){ Add-Content -LiteralPath $log ("{0}  {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $m) }

# 1) export (live DB -> data.json + images)
$summary = & node (Join-Path $SITE 'export.js')
if ($LASTEXITCODE -ne 0) { Log "EXPORT ERROR (exit $LASTEXITCODE): $summary"; exit 1 }
Log "export: $summary"

# link.json — the live public address of the app, so the STABLE GitHub links
# (entrar.html / hk.html) can forward to it. The free Cloudflare quick tunnel
# gets a new hostname on every restart; this is what keeps the bookmark working.
$tunFile = 'C:\Users\verdelagoresort\.local\bin\lost-and-found\current_url.txt'
if (Test-Path $tunFile) {
  $tun = (Get-Content -LiteralPath $tunFile -Raw).Trim().TrimEnd('/')
  if ($tun -match '^https://') {
    $link = [ordered]@{
      app     = $tun
      hk      = "$tun/hk/new"
      painel  = "$tun/dashboard"
      lan     = 'http://172.27.90.228:3500'
      updated = (Get-Date).ToString('s')
    }
    $json = $link | ConvertTo-Json
    $linkPath = Join-Path $SITE 'link.json'
    $old = if (Test-Path $linkPath) { (Get-Content -LiteralPath $linkPath -Raw) } else { '' }
    # compare ignoring the timestamp so an unchanged tunnel doesn't force a commit
    if (($old -replace '"updated".*','') -ne ($json -replace '"updated".*','')) {
      [IO.File]::WriteAllText($linkPath, $json, (New-Object Text.UTF8Encoding($false)))
      Log "link.json updated -> $tun"
    }
  }
}

# 2) stage / commit only if something changed
Set-Location -LiteralPath $SITE
& $GIT add -A | Out-Null
if (-not (& $GIT status --porcelain)) { Log 'no changes'; exit 0 }
$count = (Get-Content -LiteralPath (Join-Path $SITE 'data.json') -Raw | ConvertFrom-Json).count
$msg = "sync {0} - {1} artigos" -f (Get-Date).ToString('yyyy-MM-dd HH:mm'), $count
& $GIT -c user.name='Diogo Salvador' -c user.email='diogosalvador2003@gmail.com' commit -q -m $msg | Out-Null

# 3) push over SSH with a repo deploy key.
# Deliberately NOT a personal access token: the PAT on this box expires 2026-08-12,
# and when it did the publish would fail silently -> link.json goes stale -> every
# staff link forwards to a dead tunnel. Deploy keys do not expire.
$env:GIT_TERMINAL_PROMPT = '0'
$KEY = "$env:USERPROFILE\.ssh\verdelago_lostfound_deploy"
if (-not (Test-Path $KEY)) { Log 'PUSH ERROR: deploy key missing'; exit 1 }
$env:GIT_SSH_COMMAND = "ssh -i `"$KEY`" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=`"$env:USERPROFILE\.ssh\known_hosts`""
$out = & $GIT push ("git@github.com:$OWNER/$REPO.git") 'main:main' 2>&1
$ex = $LASTEXITCODE
if ($ex -ne 0) { Log ("PUSH ERROR (exit $ex): " + ($out -join ' ')); exit 1 }
Log ("pushed: $count artigos")
