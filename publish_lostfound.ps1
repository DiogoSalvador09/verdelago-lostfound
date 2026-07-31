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

# 3) push with a token pulled from the Windows vault (never prompts, never logged)
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
$env:GIT_TERMINAL_PROMPT='0'
$bt = [CredManP]::Read('git:https://github.com')
if ($bt) { $tok = [Text.Encoding]::Unicode.GetString($bt).Trim([char]0).Trim() } else { $tok = '' }
if ($tok -notmatch '^(gh[pousr]_|github_pat_)') { Log 'PUSH ERROR: no token in credential store'; exit 1 }
$out = (& $GIT push ("https://$tok@github.com/$OWNER/$REPO.git") 'main:main' 2>&1) | ForEach-Object { $_ -replace [regex]::Escape($tok),'***' }
$ex = $LASTEXITCODE; $tok = $null; $bt = $null
if ($ex -ne 0) { Log ("PUSH ERROR (exit $ex): " + ($out -join ' ')); exit 1 }
Log ("pushed: $count artigos")
