; QT Suite installer (Inno Setup 6). Built by packaging\build.ps1, which passes AppVersion, AppDir and OutDir.
; Installs for the current user only (no admin prompt) into %LOCALAPPDATA%\Programs\QT Suite, like VS Code's
; user installer, so the tools can keep their small working files next to themselves.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef AppDir
  #define AppDir "..\..\build\app"
#endif
#ifndef OutDir
  #define OutDir "..\..\out"
#endif

[Setup]
AppId={{6F1C4B2A-9D3E-4F5A-8B7C-2E1D0A9F8C31}
AppName=QT Suite
AppVersion={#AppVersion}
AppVerName=QT Suite {#AppVersion}
AppPublisher=FlameBLIZZard and contributors
AppPublisherURL=https://github.com/FlameBLIZZard/qt-suite
AppSupportURL=https://github.com/FlameBLIZZard/qt-suite/issues
AppUpdatesURL=https://github.com/FlameBLIZZard/qt-suite/releases
AppCopyright=Copyright (c) 2026 FlameBLIZZard and contributors
VersionInfoVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\QT Suite
DefaultGroupName=QT Suite
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
LicenseFile={#AppDir}\LICENSE
OutputDir={#OutDir}
OutputBaseFilename=QT-Suite-Setup-{#AppVersion}
SetupIconFile={#AppDir}\suite\suite.ico
UninstallDisplayIcon={app}\QT Suite.exe
UninstallDisplayName=QT Suite
WizardStyle=modern
WizardImageFile=wizard-big.bmp
WizardSmallImageFile=wizard-small.bmp
Compression=lzma2/ultra64
SolidCompression=yes
CloseApplications=no
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel2=This installs [name/ver] on your PC.%n%nOne window for your tools: send files to your phone, download media, browse files, see your games, play sounds into your mic, free up disk space and more. Everything runs on this PC; nothing goes to the cloud.%n%nClose QT Suite before you continue if it's running.

[Tasks]
Name: "desktopicon"; Description: "Put a QT Suite shortcut on the desktop"; GroupDescription: "Shortcuts:"
Name: "startup"; Description: "Start QT Suite quietly when I sign in to Windows (it lives in the tray)"; GroupDescription: "Start-up:"; Flags: unchecked

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\QT Suite"; Filename: "{app}\QT Suite.exe"; WorkingDir: "{app}"; Comment: "All your QT tools in one window"
Name: "{group}\Uninstall QT Suite"; Filename: "{uninstallexe}"
Name: "{autodesktop}\QT Suite"; Filename: "{app}\QT Suite.exe"; WorkingDir: "{app}"; Tasks: desktopicon
; the same Startup shortcut the in-app "Start with Windows" switch makes, so the two stay in sync
Name: "{userstartup}\QT Suite"; Filename: "{app}\QT Suite.exe"; Parameters: "--no-window"; WorkingDir: "{app}"; Tasks: startup

[Run]
Filename: "{app}\QT Suite.exe"; Description: "Open QT Suite now"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; ask a running hub to quit (it stops its tray icon), then stop anything still running from the install folder
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ""try {{ Invoke-WebRequest -UseBasicParsing -Method POST -Headers @{{Origin='http://127.0.0.1:7800'} http://127.0.0.1:7800/api/quit -TimeoutSec 3 | Out-Null } catch {{}; Start-Sleep 1; Get-CimInstance Win32_Process | Where-Object {{ $_.ExecutablePath -like '{app}\runtime\*' } | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"""; Flags: runhidden waituntilterminated; RunOnceId: "StopQT"

[UninstallDelete]
; files the tools made inside the install folder (caches, compiled Python, Launchpad's window profile)
Type: filesandordirs; Name: "{app}\launcher\data"
Type: filesandordirs; Name: "{app}\suite\__pycache__"
Type: filesandordirs; Name: "{app}\daily\__pycache__"
Type: filesandordirs; Name: "{app}\beam\__pycache__"
Type: filesandordirs; Name: "{app}\launcher\__pycache__"
Type: filesandordirs; Name: "{app}\volt\__pycache__"
Type: filesandordirs; Name: "{app}\burrow\__pycache__"
Type: filesandordirs; Name: "{app}\lens-pc\__pycache__"
Type: filesandordirs; Name: "{app}\soundboard\__pycache__"
Type: filesandordirs; Name: "{app}\space-manager\__pycache__"
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\suite\defaults"
Type: files; Name: "{userstartup}\QT Suite.lnk"
Type: dirifempty; Name: "{app}"

[Code]
var
  KeepData: Boolean;

function InitializeSetup(): Boolean;
var
  Code: Integer;
begin
  { an older copy may be running: ask it to quit so its files can be replaced }
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -WindowStyle Hidden -Command "try { Invoke-WebRequest -UseBasicParsing -Method POST -Headers @{Origin=''http://127.0.0.1:7800''} http://127.0.0.1:7800/api/quit -TimeoutSec 2 | Out-Null } catch {}"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := True;
end;

function InitializeUninstall(): Boolean;
begin
  KeepData := SuppressibleMsgBox('Keep your QT Suite settings, notes, to-dos and tool data?' + #13#10 + #13#10 +
    'Choose Yes if you might install QT Suite again. Choose No to remove them too.',
    mbConfirmation, MB_YESNO or MB_DEFBUTTON1, IDYES) = IDYES;  { silent uninstalls keep data }
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  L: String;
begin
  if (CurUninstallStep = usPostUninstall) and not KeepData then
  begin
    L := ExpandConstant('{localappdata}');
    DelTree(L + '\QT Suite', True, True, True);
    DelTree(L + '\Burrow', True, True, True);
    DelTree(L + '\SpaceManager', True, True, True);
    DelTree(L + '\LensPC', True, True, True);
    DelTree(L + '\volt', True, True, True);
    DelTree(L + '\Beam', True, True, True);
    DelTree(ExpandConstant('{app}'), True, True, True);
  end;
end;
