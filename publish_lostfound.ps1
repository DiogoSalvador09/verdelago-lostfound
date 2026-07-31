# Publishes the privacy-safe Lost & Found catalogue to the GitHub Pages viewer.
#   1) export.js : live DB -> data.json + images (whitelisted fields only)
#   2) git commit & push to origin/main (token read from Windows Credential Manager)
# Safe to run UNATTENDED on a schedule: no prompts, exits 0 with "no changes" when idle.
$SITE  = 'C:\Users\verdelagoresort\.local\bin\lostfound-web'
$GIT   = 'C:\Program Files\Git\cmd\git.exe'
$OWNER = 'DiogoSalvador09'; $REPO = 'verdelago-lostfound'
$log   = Join-Path $SITE 'publish.log'
function Log($m){ Add-Content -LiteralPath $log ("{0}  {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $m) }

# A silent publish failure is the dangerous one: staff links keep pointing at a
# tunnel address that no longer exists. Shout on WhatsApp (same channel the rest
# of the fleet uses) and drop a desktop file as a fallback.
function Alert($m){
  Log "ALERT: $m"
  try {
    $s = Get-Content 'C:\Users\verdelagoresort\.local\bin\secrets.local.json' -Raw | ConvertFrom-Json
    $uri = "https://api.green-api.com/waInstance$($s.greenApiInstance)/sendMessage/$($s.greenApiToken)"
    $body = @{ chatId = '351935545772@c.us'; message = "[Perdidos e Achados] $m" } | ConvertTo-Json  # Diogo, same as the rest of the fleet
    Invoke-RestMethod -Method POST -Uri $uri -Body $body -ContentType 'application/json' -TimeoutSec 20 | Out-Null
  } catch { Log "  (WhatsApp alert failed: $($_.Exception.Message))" }
  try { Set-Content -LiteralPath "$env:USERPROFILE\Desktop\ALERTA_perdidos_achados.txt" -Value $m -Encoding utf8 } catch {}
}

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

# 3) push over HTTPS with the token from the Windows vault.
# SSH was tried and is NOT usable from this box: the corporate network kills the
# SSH banner exchange on both port 22 and ssh.github.com:443, so a deploy key
# (which would never expire) cannot be used. That leaves the PAT — and the PAT
# EXPIRES, so a failed push must be loud, never silent: if it dies, link.json
# stops tracking the rotating tunnel and every staff link breaks quietly.
Add-Type @'
using System; using System.Runtime.InteropServices;
public class CredManP {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL { public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob;
    public uint Persist; public uint AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string t, uint ty, uint f, out IntPtr c);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr c);
  public static byte[] Read(string t){ IntPtr p; if(!CredRead(t,1,0,out p)) return null;
    try{ CREDENTIAL c=(CREDENTIAL)Marshal.PtrToStructure(p,typeof(CREDENTIAL)); byte[] b=new byte[c.CredentialBlobSize];
    if(c.CredentialBlobSize>0) Marshal.Copy(c.CredentialBlob,b,0,(int)c.CredentialBlobSize); return b; } finally { CredFree(p); } }
}
'@
$env:GIT_TERMINAL_PROMPT = '0'
$bt = [CredManP]::Read('git:https://github.com')
if ($bt) { $tok = [Text.Encoding]::Unicode.GetString($bt).Trim([char]0).Trim() } else { $tok = '' }
if ($tok -notmatch '^(gh[pousr]_|github_pat_)') { Alert 'Sem token do GitHub - o site deixou de actualizar.'; exit 1 }
$out = (& $GIT push ("https://$tok@github.com/$OWNER/$REPO.git") 'main:main' 2>&1) | ForEach-Object { $_ -replace [regex]::Escape($tok),'***' }
$ex = $LASTEXITCODE; $tok = $null; $bt = $null
if ($ex -ne 0) {
  Alert ("Falha ao publicar no GitHub (exit $ex). Se o token expirou, os links do pessoal deixam de funcionar. " + ($out -join ' '))
  exit 1
}
Log ("pushed: $count artigos")
