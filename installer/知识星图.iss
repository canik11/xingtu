; 知识星图安装包脚本（Inno Setup 6）
; 构建：powershell -File scripts\build-installer.ps1
; 版本号由构建脚本通过 /DAppVersion=x.y.z 传入，默认 0.3.0。

#define AppName "知识星图"
#ifndef AppVersion
  #define AppVersion "0.3.0"
#endif
#define AppPublisher "canik"
#define AppExeName "知识星图.exe"
#define AppId "{{B7E7F3EA-6B0E-4A45-9F0E-2C9D2C4B6A11}"
#define WebView2Url "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://gitee.com/canik/xintu
AppSupportURL=https://gitee.com/canik/xintu
DefaultDirName={localappdata}\Programs\知识星图
DefaultGroupName=知识星图
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\packaging\dist
OutputBaseFilename=知识星图-安装包-{#AppVersion}
SetupIconFile=..\assets\xintu.ico
UninstallDisplayIcon={app}\xintu.ico
UninstallDisplayName={#AppName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UsePreviousAppDir=yes
CloseApplications=yes
RestartApplications=no
AllowNoIcons=yes

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式(&D)"; GroupDescription: "附加任务："; Flags: checkedonce
Name: "startmenuicon"; Description: "创建开始菜单快捷方式(&S)"; GroupDescription: "附加任务："; Flags: checkedonce

[Files]
Source: "..\app\*"; DestDir: "{app}"; Excludes: "create-shortcut.cmd,create-shortcut.ps1"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\知识星图"; Filename: "{app}\知识星图.exe"; IconFilename: "{app}\xintu.ico"; Tasks: desktopicon
Name: "{group}\知识星图"; Filename: "{app}\知识星图.exe"; IconFilename: "{app}\xintu.ico"; Tasks: startmenuicon
Name: "{group}\卸载 知识星图"; Filename: "{uninstallexe}"; Tasks: startmenuicon

[Run]
Filename: "{app}\知识星图.exe"; Description: "启动 知识星图"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
var
  DownloadPage: TDownloadWizardPage;

function WebView2Installed(): Boolean;
var
  Version: String;
begin
  Result :=
    RegQueryStringValue(HKLM64, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  if Result and ((Version = '') or (Version = '0.0.0.0')) then
    Result := False;
end;

procedure InitializeWizard();
begin
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing),
    '知识星图需要 Microsoft WebView2 运行时。正在联网下载，请稍候…', nil);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if WebView2Installed() then
    Exit;

  DownloadPage.Clear;
  DownloadPage.Add('{#WebView2Url}', 'MicrosoftEdgeWebview2Setup.exe', '');
  DownloadPage.Show;
  try
    try
      DownloadPage.Download;
    except
      if MsgBox('WebView2 运行时下载失败，可能是网络问题。' + #13#10 + #13#10 +
          '可以稍后手动安装，或继续安装知识星图（应用可能无法启动）。' + #13#10 +
          '是否继续安装？', mbError, MB_YESNO) = IDNO then
        Abort;
      Exit;
    end;
  finally
    DownloadPage.Hide;
  end;

  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    MsgBox('WebView2 运行时安装程序启动失败。' + #13#10 +
      '知识星图仍会安装，但首次启动可能提示缺少 WebView2。', mbError, MB_OK);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    // 静默卸载不弹窗，默认保留数据，避免批处理/脚本卡住。
    if UninstallSilent then
      Exit;
    DataDir := ExpandConstant('{localappdata}\KnowledgeStarmap');
    if DirExists(DataDir) then
    begin
      if MsgBox('是否同时删除本地知识数据？' + #13#10 + #13#10 +
          DataDir + #13#10 + #13#10 +
          '选择“否”会保留数据，重新安装后仍可继续使用。',
          mbConfirmation, MB_YESNO) = IDYES then
        DelTree(DataDir, True, True, True);
    end;
  end;
end;