<#
  Makes docs\media: README screenshots (PNG) and demo clips (GIF + MP4) from a demo copy of a QT Suite build.
  Nothing real shows: the tools run from a temp copy with a made-up user folder (demo_home.py), their own
  temp app data, and spare ports. A copy that's installed or running on this PC is never touched.

    powershell -ExecutionPolicy Bypass -File packaging\media\make_media.ps1 [-Zip out\QT-Suite-<ver>-portable.zip]
  Needs Node with Playwright (NODE_PATH), Edge or Chrome (CHROME=<path>), and ffmpeg on PATH.
#>
param([string]$Zip)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Out = Join-Path $Repo 'docs\media'
if (-not $Zip) { $Zip = Get-ChildItem (Join-Path $Repo 'out') -Filter '*-portable.zip' | Sort-Object LastWriteTime | Select-Object -Last 1 -ExpandProperty FullName }
if (-not $env:CHROME) { $env:CHROME = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" }
$tmp = Join-Path $env:TEMP ("qt-media-" + [guid]::NewGuid().ToString('N').Substring(0, 6))
$app = Join-Path $tmp 'app'; $home2 = Join-Path $env:PUBLIC 'QT Demo';   # shows as ~\QT Demo in the viewers
 $data = Join-Path $tmp 'localappdata'; $roam = Join-Path $tmp 'appdata'
Expand-Archive $Zip $app
New-Item -ItemType Directory $data, $roam -Force | Out-Null
Remove-Item $home2 -Recurse -Force -ErrorAction SilentlyContinue
python (Join-Path $PSScriptRoot 'demo_home.py') $home2
$env:QT_MEDIA_HIDE = ((Get-Volume | Where-Object FileSystemLabel).FileSystemLabel -join '|')   # drive names can carry a person's name
$pyw = Join-Path $app 'runtime\pythonw.exe'

# real port -> demo port
$map = [ordered]@{ '7795' = 7892; '7777' = 7893; '7793' = 7894; '7799' = 7895; '7788' = 7896; '7790' = 7897; '7797' = 7898 }
$saved = @{}; foreach ($k in 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'QT_SUITE_PORT', 'QT_SUITE_DATA') { $saved[$k] = [Environment]::GetEnvironmentVariable($k) }
function Wait-Port($port, $s = 30) { for ($i = 0; $i -lt $s * 4; $i++) { if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { return $true }; Start-Sleep -Milliseconds 250 }; $false }
foreach ($port in @(7891) + @($map.Values)) { if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "port $port is in use; free it or change the demo ports" } }
try {
  $env:LOCALAPPDATA = $data; $env:APPDATA = $roam; $env:USERPROFILE = $home2
  $env:DAILY_VOLT_PORT = $map['7777']; $env:DAILY_LENS_PORT = $map['7797']; $env:BEAM_DAILY_PORT = $map['7799']; $env:LENSPC_BEAM_PORT = $map['7788']
  @{ port = $map['7788']; inbox = "$home2\Downloads\Beam"; key = 'demo-key'; open_browser = $false } | ConvertTo-Json | Set-Content "$tmp\beam.json"
  $runs = @(
    @('burrow', @{ BURROW_PORT = $map['7795']; BURROW_DATA = "$data\Burrow" }, @('app.py', '--no-window')),
    @('volt', @{ VOLT_PORT = $map['7777'] }, @('app.py', '--no-browser')),
    @('space-manager', @{ SPACE_PORT = $map['7793']; SPACE_DATA = "$data\SpaceManager" }, @('app.py', '--no-window')),
    @('daily', @{ DAILY_PORT = $map['7799'] }, @('app.py', '--no-window')),
    @('beam', @{ BEAM_CONFIG = "$tmp\beam.json"; BEAM_PORT = $map['7788']; BEAM_NO_BROWSER = '1' }, @('app.py')),
    @('launcher', @{ LAUNCHPAD_PORT = $map['7790'] }, @('app.py', '--no-window'))
  )
  foreach ($r in $runs) {
    foreach ($k in $r[1].Keys) { Set-Item "Env:$k" $r[1][$k] }
    Start-Process $pyw -ArgumentList $r[2] -WorkingDirectory (Join-Path $app $r[0])
    foreach ($k in $r[1].Keys) { Remove-Item "Env:$k" }
  }
  $env:QT_SUITE_PORT = '7891'; $env:QT_SUITE_DATA = "$data\QT Suite"
  Start-Process (Join-Path $app 'QT Suite.exe') -ArgumentList '--no-window'
  foreach ($p in @(7891) + @($map.Values | Where-Object { $_ -ne 7898 })) { if (-not (Wait-Port $p)) { throw "port $p didn't come up" } }
  Start-Sleep 3

  if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
  New-Item -ItemType Directory $Out | Out-Null
  $json = ($map | ConvertTo-Json -Compress)
  foreach ($k in 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE') { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }   # the browser needs the real profile folders
  $env:QT_MEDIA_MAP = $json; node (Join-Path $PSScriptRoot 'capture.cjs') 7891 $Out $home2 map
  if ($LASTEXITCODE) { throw 'capture failed' }

  # clips: webm -> mp4 (h264, for the site / releases) and gif (README; 960 px, 12 fps)
  Get-ChildItem "$Out\clips\_raw\*.ffconcat" | ForEach-Object {
    $b = Join-Path "$Out\clips" $_.BaseName
    ffmpeg -v error -y -f concat -safe 0 -i $_.FullName -vf "fps=30,format=yuv420p" -c:v libx264 -crf 24 -movflags +faststart -an "$b.mp4"
    ffmpeg -v error -y -i "$b.mp4" -vf "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" "$b.gif"
  }
  Remove-Item "$Out\clips\_raw" -Recurse -Force -ErrorAction SilentlyContinue
}
finally {
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$app\runtime\*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  foreach ($k in 'DAILY_VOLT_PORT', 'DAILY_LENS_PORT', 'BEAM_DAILY_PORT', 'LENSPC_BEAM_PORT') { Remove-Item "Env:$k" -ErrorAction SilentlyContinue }
  Start-Sleep 1; Remove-Item $tmp, $home2 -Recurse -Force -ErrorAction SilentlyContinue
}
Get-ChildItem $Out -Recurse -File | Format-Table @{n = 'file'; e = { $_.FullName.Replace("$Out\", '') } }, @{n = 'KB'; e = { [int]($_.Length / 1KB) } } -AutoSize
