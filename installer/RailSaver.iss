; Inno Setup script for RailSaver (per-user install, no administrator rights needed).
; Built by .github/workflows/build.yml:  ISCC /DAppVersion=x.y.z /DSourceDir=..\publish installer\RailSaver.iss

#define AppName "RailSaver"
#define AppExe "RailSaver.exe"
#define AppScr "RailSaver.scr"
#ifndef AppVersion
  #define AppVersion "0.7.1"
#endif
#ifndef SourceDir
  #define SourceDir "..\publish"
#endif

[Setup]
AppId={{5E2B7C41-9A3D-4F6B-8C1E-2D7A9B3E4F50}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Ax-Easy (Vangelis Makridakis)
AppPublisherURL=https://github.com/vagdesign/RailSaver
DefaultDirName={localappdata}\Programs\RailSaver
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir=..\out
OutputBaseFilename=RailSaver-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
SetupIconFile=..\src\RailSaver\RailSaver.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName} screen saver
WizardStyle=modern
CloseApplications=yes
LicenseFile=..\LICENSE

[Tasks]
Name: "setactive"; Description: "Use RailSaver as my screen saver"; GroupDescription: "Screen saver:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\RailSaver\RailSaver Settings"; Filename: "{app}\{#AppExe}"; Parameters: "/c"
Name: "{autoprograms}\RailSaver\RailSaver (run now)"; Filename: "{app}\{#AppExe}"; Parameters: "/s"
Name: "{autoprograms}\RailSaver\RailSaver in a window"; Filename: "{app}\{#AppExe}"; Parameters: "/w"

[Run]
Filename: "{app}\{#AppExe}"; Parameters: "/c"; Description: "Open RailSaver settings"; Flags: nowait postinstall skipifsilent unchecked
Filename: "{sys}\control.exe"; Parameters: "desk.cpl,,@screensaver"; Description: "Open the Windows Screen Saver Settings"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\RailSaver"

[Code]
const
  DesktopKey = 'Control Panel\Desktop';

function WebView2Installed(): Boolean;
var
  Version: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  Result := Result and (Version <> '') and (Version <> '0.0.0.0');
end;

function InitializeSetup(): Boolean;
var
  ErrorCode: Integer;
begin
  Result := True;
  if not WebView2Installed() then
  begin
    if MsgBox('RailSaver draws the 3D clock with the Microsoft Edge WebView2 Runtime, which was not found on this PC.' + #13#10#13#10 +
              'Without it RailSaver shows a flat clock. Open the download page now?', mbConfirmation, MB_YESNO) = IDYES then
      ShellExec('open', 'https://developer.microsoft.com/microsoft-edge/webview2/', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Scr, Timeout: String;
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('setactive') then
  begin
    // Windows keeps the active screen saver as a path in the registry. The short
    // (8.3) form avoids trouble with spaces in the user name.
    Scr := GetShortName(ExpandConstant('{app}\{#AppScr}'));
    RegWriteStringValue(HKCU, DesktopKey, 'SCRNSAVE.EXE', Scr);
    RegWriteStringValue(HKCU, DesktopKey, 'ScreenSaveActive', '1');
    if not RegQueryStringValue(HKCU, DesktopKey, 'ScreenSaveTimeOut', Timeout) or (Timeout = '') or (Timeout = '0') then
      RegWriteStringValue(HKCU, DesktopKey, 'ScreenSaveTimeOut', '300');
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Scr: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    if RegQueryStringValue(HKCU, DesktopKey, 'SCRNSAVE.EXE', Scr) and
       ((Pos('RAILSA', Uppercase(Scr)) > 0) or (Pos('RAILSAVER', Uppercase(Scr)) > 0)) then
    begin
      RegDeleteValue(HKCU, DesktopKey, 'SCRNSAVE.EXE');
      RegWriteStringValue(HKCU, DesktopKey, 'ScreenSaveActive', '0');
    end;
  end;
end;
