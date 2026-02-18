; Zotero Infinity - Bundled Windows Installer
; Requires Inno Setup 6.x (https://jrsoftware.org/isinfo.php)

#define MyAppName "Zotero Infinity"
#define MyAppVersion "3.1.0"
#define MyAppPublisher "irbaz.dev"
#define MyAppURL "https://github.com/irbazalam/zotero-local-ai"
#define MyAddonID "zotero-local-ai@irbaz.dev"

[Setup]
AppId={{B8E3F2A1-7C4D-4E5F-9A1B-2C3D4E5F6A7B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=output
OutputBaseFilename=ZoteroInfinity-Setup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Ollama installer
Source: "dist\OllamaSetup.exe"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall

; Zotero plugin XPI
Source: "dist\zotero-local-ai.xpi"; DestDir: "{app}"; Flags: ignoreversion

; Post-install script
Source: "post-install.ps1"; DestDir: "{tmp}"; Flags: ignoreversion deleteafterinstall

[Run]
; Step 1: Install Ollama silently (skip if already installed)
Filename: "{tmp}\OllamaSetup.exe"; Parameters: "/VERYSILENT /NORESTART /SP-"; StatusMsg: "Installing Ollama AI engine..."; Flags: waituntilterminated; Check: not IsOllamaInstalled

; Step 2: Run post-install script to start Ollama and pull model
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{tmp}\post-install.ps1"""; StatusMsg: "Downloading AI model (this may take a few minutes)..."; Flags: waituntilterminated runhidden

[Code]
var ZoteroProfilePath: String;

function IsOllamaInstalled: Boolean;
var
  OllamaPath: String;
begin
  OllamaPath := ExpandConstant('{localappdata}\Programs\Ollama\ollama.exe');
  Result := FileExists(OllamaPath);
  if not Result then
  begin
    OllamaPath := ExpandConstant('{userappdata}\.ollama\ollama.exe');
    Result := FileExists(OllamaPath);
  end;
  if not Result then
  begin
    OllamaPath := ExpandConstant('{localappdata}\Ollama\ollama.exe');
    Result := FileExists(OllamaPath);
  end;
end;

function FindZoteroProfile: String;
var
  ProfilesDir: String;
  FindRec: TFindRec;
begin
  Result := '';
  ProfilesDir := ExpandConstant('{userappdata}\Zotero\Zotero\Profiles\');
  if FindFirst(ProfilesDir + '*', FindRec) then
  begin
    try
      repeat
        if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0) and
           (FindRec.Name <> '.') and (FindRec.Name <> '..') then
        begin
          Result := ProfilesDir + FindRec.Name;
          Break;
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
end;

procedure InstallXPIToZotero;
var
  ProfileDir: String;
  ExtDir: String;
  XPISrc: String;
  XPIDest: String;
begin
  ProfileDir := FindZoteroProfile;
  if ProfileDir = '' then
  begin
    Log('No Zotero profile found. User will need to install .xpi manually.');
    Exit;
  end;

  ExtDir := ProfileDir + '\extensions';
  if not DirExists(ExtDir) then
    ForceDirectories(ExtDir);

  XPISrc := ExpandConstant('{app}\zotero-local-ai.xpi');
  XPIDest := ExtDir + '\{#MyAddonID}.xpi';

  if FileCopy(XPISrc, XPIDest, False) then
    Log('XPI installed to: ' + XPIDest)
  else
    Log('Failed to copy XPI to extensions directory');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    InstallXPIToZotero;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := '';
  Result := Result + 'The installer will:' + NewLine + NewLine;
  if not IsOllamaInstalled then
    Result := Result + Space + '1. Install Ollama (local AI engine)' + NewLine
  else
    Result := Result + Space + '1. Ollama already installed (skip)' + NewLine;
  Result := Result + Space + '2. Install Zotero Infinity plugin' + NewLine;
  Result := Result + Space + '3. Download the AI model (~700 MB)' + NewLine;
  Result := Result + NewLine;
  Result := Result + 'After installation, simply open Zotero' + NewLine;
  Result := Result + 'and the AI Chat will be ready to use.' + NewLine;
end;
