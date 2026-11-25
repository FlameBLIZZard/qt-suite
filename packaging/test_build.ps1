<#
  Smoke-tests a built QT Suite without touching a copy that's already installed or running:
  unzips the portable build into a temp folder, points LOCALAPPDATA at a temp folder too, and starts
  the hub and each tool on spare ports with the bundled Python. Everything it started is stopped at the end.

    powershell -ExecutionPolicy Bypass -File packaging\test_build.ps1 [-Zip out\QT-Suite-1.0.0-portable.zip] [-Dir <already unpacked folder>]
#>
param([string]$Zip, [string]$Dir)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path $env:TEMP ("qt-build-test-" + [guid]::NewGuid().ToString('N').Substring(0, 6))
if (-not $Dir) {
  if (-not $Zip) { $Zip = Get-ChildItem (Join-Path $Repo 'out') -Filter '*-portable.zip' | Sort-Object LastWriteTime | Select-Object -Last 1 -ExpandProperty FullName }
  $Dir = Join-Path $tmp 'app'; Expand-Archive $Zip $Dir
}
$data = Join-Path $tmp 'localappdata'; New-Item -ItemType Directory $data -Force | Out-Null
$py = Join-Path $Dir 'runtime\python.exe'; $pyw = Join-Path $Dir 'runtime\pythonw.exe'
$fail = 0
function Check($name, $ok, $more) { if ($ok) { "PASS  $name" } else { "FAIL  $name $more"; $script:fail++ } }
function Get-Url($u) { try { (Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 5).StatusCode } catch { $_.Exception.Message } }
function Wait-Port($port, $s = 25) { for ($i = 0; $i -lt $s * 4; $i++) { if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { return $true }; Start-Sleep -Milliseconds 250 }; $false }

$saved = @{}; foreach ($k in 'LOCALAPPDATA', 'QT_SUITE_PORT', 'QT_SUITE_DATA', 'PYTHONPATH', 'PYTHONHOME') { $saved[$k] = [Environment]::GetEnvironmentVariable($k) }
try {
  $env:LOCALAPPDATA = $data; Remove-Item Env:PYTHONPATH, Env:PYTHONHOME -ErrorAction SilentlyContinue
  # 1. the bundled Python has everything the tools import, and nothing from this PC's own Python
  $out = & $py -s -c "import sys, PIL, numpy, sounddevice, soundfile, keyboard, onnxruntime, flask, yt_dlp, gallery_dl, curl_cffi, tkinter, sqlite3, ssl; print(sys.prefix)" 2>&1
  Check 'bundled Python imports every package' ($LASTEXITCODE -eq 0 -and "$out" -like "$Dir*") "$out"

  # 2. QT Suite.exe starts the hub (spare port, temp data)
  $env:QT_SUITE_PORT = '7841'; $env:QT_SUITE_DATA = Join-Path $data 'QT Suite'
  Start-Process (Join-Path $Dir 'QT Suite.exe') -ArgumentList '--no-window'
  Check 'QT Suite.exe starts the hub' (Wait-Port 7841) ''
  $tools = (Invoke-WebRequest http://127.0.0.1:7841/api/tools -UseBasicParsing).Content | ConvertFrom-Json
  Check "hub lists the tools ($($tools.Count))" ($tools.Count -ge 15 -and -not ($tools.id -contains 'apks')) ''
  Check 'hub page' ((Get-Url http://127.0.0.1:7841/) -eq 200) ''
  Check 'hub nova + spark APIs' ((Get-Url http://127.0.0.1:7841/api/nova/store) -eq 200 -and (Get-Url http://127.0.0.1:7841/api/spark/sys) -eq 200) ''
  $g = try { Invoke-RestMethod http://127.0.0.1:7841/api/guide/state -TimeoutSec 5 } catch { $null }
  Check 'first run: welcome is due, version shown' ($g -and $g.fresh -and -not $g.onboarded -and $g.version -eq (Get-Content (Join-Path $Repo 'VERSION') -Raw).Trim()) "$($g | ConvertTo-Json -Compress)"
  Check 'Help, tour and welcome files served' ((Get-Url http://127.0.0.1:7841/guide.js) -eq 200 -and (Get-Url http://127.0.0.1:7841/guide.css) -eq 200 -and (Get-Url http://127.0.0.1:7841/api/guide/changelog) -eq 200) ''
  Check 'file tools served (Inkmotion, Pixlab, viewers)' ((Get-Url http://127.0.0.1:7841/tool/inkmotion) -eq 200 -and (Get-Url http://127.0.0.1:7841/tool/pixlab) -eq 200 -and (Get-Url http://127.0.0.1:7841/tool/pictures) -eq 200) ''
  $hubProc = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$Dir\runtime\*" -and $_.CommandLine -like '*app.py*' }
  Check 'hub runs on the bundled pythonw' ([bool]$hubProc) ''
  Remove-Item Env:QT_SUITE_PORT, Env:QT_SUITE_DATA

  # 3. each tool starts on the bundled Python (spare ports)
  $runs = @(
    @('daily', 'DAILY_PORT', 7849, @('app.py', '--no-window'), '/'),
    @('launcher', 'LAUNCHPAD_PORT', 7850, @('app.py', '--no-window'), '/'),
    @('volt', 'VOLT_PORT', 7851, @('app.py', '--no-browser'), '/api/status'),
    @('burrow', 'BURROW_PORT', 7852, @('app.py', '--no-window'), '/'),
    @('lens-pc', 'LENSPC_PORT', 7853, @('app.py', '--no-window'), '/'),
    @('space-manager', 'SPACE_PORT', 7854, @('app.py', '--no-window'), '/')
  )
  foreach ($r in $runs) {
    Set-Item "Env:$($r[1])" $r[2]
    Start-Process $pyw -ArgumentList $r[3] -WorkingDirectory (Join-Path $Dir $r[0])
    $up = Wait-Port $r[2] 30
    Check "$($r[0]) answers on the bundled Python" ($up -and (Get-Url "http://127.0.0.1:$($r[2])$($r[4])") -eq 200) ''
    Remove-Item "Env:$($r[1])"
  }
  # Beam and Soundboard use fixed ports / global hotkeys: check they load
  $out = & $py -s -c "import sys, os; sys.path.insert(0, r'$Dir\beam'); import vault, ping, drop, kharchasync, lenslink; sys.path.insert(0, r'$Dir\soundboard'); import engine; print('ok')" 2>&1
  Check 'Beam + Soundboard modules load' ("$out" -match 'ok$') "$out"
  foreach ($f in Get-ChildItem $Dir -Recurse -Filter *.py | Where-Object FullName -notlike "$Dir\runtime\*") {
    & $py -s -m py_compile $f.FullName 2>&1 | Out-Null; if ($LASTEXITCODE) { Check "compile $($f.Name)" $false ''; }
  }
  $pw = Join-Path $PSScriptRoot 'private-words.txt'   # names / labels that must not ship (kept out of git)
  $leaks = @('C:\\Users\\[^\\]+\\(Desktop|Documents|Downloads|Pictures)\\') + @(if (Test-Path $pw) { Get-Content $pw | Where-Object { $_ -and -not $_.StartsWith('#') } | ForEach-Object { [regex]::Escape($_) } })
  Check 'no personal data in the build' (-not (Get-ChildItem $Dir -Recurse -File -Include *.py, *.js, *.html, *.json, *.md, *.txt | Where-Object FullName -notlike "$Dir\runtime\*" | Select-String -Pattern $leaks -List)) ''
}
finally {
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$Dir\runtime\*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  Start-Sleep 1
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
"`n$(if ($fail) { "$fail FAILED" } else { 'ALL BUILD CHECKS PASSED' })"
exit $fail
