<#
  Builds QT Suite for Windows:  build\app (the installed folder), out\QT-Suite-<ver>-portable.zip
  and, when Inno Setup 6 is installed, out\QT-Suite-Setup-<ver>.exe.

    powershell -ExecutionPolicy Bypass -File packaging\build.ps1 [-From C:\path\to\QT] [-SkipRuntime] [-ExtraPython <venv python.exe>]

  -From          refresh the tool folders from a working copy first (packaging\export.py)
  -SkipRuntime   reuse build\app\runtime from the last build
  -ExtraPython   a second Python that holds VOLT's engine (yt-dlp, flask, gallery-dl)
  Run it with the 64-bit python.org Python you want to ship on PATH.
#>
param([string]$From, [switch]$SkipRuntime, [string]$ExtraPython)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path $PSScriptRoot -Parent
$Version = (Get-Content (Join-Path $Repo 'VERSION') -Raw).Trim()
$App = Join-Path $Repo 'build\app'
$Out = Join-Path $Repo 'out'
$Tools = 'suite', 'daily', 'beam', 'launcher', 'volt', 'burrow', 'lens-pc', 'soundboard', 'space-manager', 'inkmotion', 'pixlab'
$Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

if ($From) { Step "Export from $From"; python (Join-Path $PSScriptRoot 'export.py') --from $From; if ($LASTEXITCODE) { throw 'export found a problem' } }

Step "Runtime"
if ($SkipRuntime -and (Test-Path "$App\runtime\pythonw.exe")) { Write-Host 'reusing build\app\runtime' }
else {
  $a = @((Join-Path $PSScriptRoot 'make_runtime.py')); if ($ExtraPython) { $a += '--extra-python', $ExtraPython }
  python @a; if ($LASTEXITCODE) { throw 'runtime build failed' }
}

Step "App files"
Get-ChildItem $App -Force | Where-Object Name -ne 'runtime' | Remove-Item -Recurse -Force
foreach ($t in $Tools) {
  robocopy (Join-Path $Repo $t) (Join-Path $App $t) /E /XD tests __pycache__ /XF *.pyc /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "copy failed: $t" }
}
foreach ($f in 'LICENSE', 'README.md', 'THIRD_PARTY.md') { Copy-Item (Join-Path $Repo $f) $App }
Copy-Item (Join-Path $Repo 'build\packages.json') (Join-Path $App 'runtime\packages.json') -ErrorAction SilentlyContinue

Step "QT Suite.exe + QTOpen.exe"
$ico = Join-Path $App 'suite\suite.ico'
& $Csc /nologo /target:winexe /optimize+ "/win32icon:$ico" "/out:$App\QT Suite.exe" /r:System.Windows.Forms.dll /r:System.Core.dll (Join-Path $PSScriptRoot 'launcher\QTSuite.cs')
if ($LASTEXITCODE) { throw 'launcher build failed' }
& $Csc /nologo /target:winexe /optimize+ "/win32icon:$ico" "/out:$App\suite\defaults\QTOpen.exe" /r:System.Windows.Forms.dll (Join-Path $App 'suite\defaults\QTOpen.cs')
if ($LASTEXITCODE) { throw 'QTOpen build failed' }

Step "Portable zip"
New-Item -ItemType Directory $Out -Force | Out-Null
$zip = Join-Path $Out "QT-Suite-$Version-portable.zip"
Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path "$App\*" -DestinationPath $zip -CompressionLevel Optimal

Step "Installer"
$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { $c = Get-Command iscc -ErrorAction SilentlyContinue; if ($c) { $iscc = $c.Source } }
if ($iscc) {
  & $iscc /Q "/DAppVersion=$Version" "/DAppDir=$App" "/DOutDir=$Out" (Join-Path $PSScriptRoot 'installer\qt-suite.iss')
  if ($LASTEXITCODE) { throw 'installer build failed' }
} else { Write-Warning 'Inno Setup 6 not found: skipped the installer (winget install JRSoftware.InnoSetup)' }

Step "Checksums"
Get-ChildItem $Out -File -Include *.exe, *.zip -Recurse | ForEach-Object { "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name } | Set-Content (Join-Path $Out 'SHA256SUMS.txt')
Get-ChildItem $Out | Format-Table Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } -AutoSize
