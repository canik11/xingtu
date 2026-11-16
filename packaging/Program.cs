using System;
using System.Drawing;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace KnowledgeStarmap
{
    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        private static void Main()
        {
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string htmlPath = Path.Combine(baseDir, "index.html");
            if (!File.Exists(htmlPath))
            {
                MessageBox.Show("没有找到 index.html，请把「知识星图.exe」和 index.html 放在同一个文件夹里。",
                    "知识星图", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            Application.Run(new MainForm(baseDir, htmlPath));
        }
    }

    internal sealed class MainForm : Form
    {
        // 标题栏跟随网页的深色顶栏：Win10 用沉浸式深色模式，Win11 再自绘标题栏颜色。
        private const int DWMWA_BORDER_COLOR = 34;
        private const int DWMWA_CAPTION_COLOR = 35;
        private const int DWMWA_TEXT_COLOR = 36;
        private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        private const int DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19;

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)]
        private static extern int SetWindowTheme(IntPtr hwnd, string appName, string idList);
        // 页面 → 壳：纯文本协议，避免 JSON 转义；路径与内容用换行分隔。
        private const string KbSaveCommand = "starmap:kb-save\n";
        private const string KbCreateCommand = "starmap:kb-create\n";
        private readonly WebView2 webView;
        private readonly string userDataFolder;
        private readonly string kbConfigFile;
        private readonly string htmlPath;
        private string kbPath;
        private bool pageDirty;
        private bool allowClose;
        private bool isFullscreen;
        private FormBorderStyle savedBorderStyle;
        private FormWindowState savedWindowState;
        private Rectangle savedBounds;

        public MainForm(string baseDir, string htmlPath)
        {
            this.htmlPath = htmlPath;
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            this.userDataFolder = Path.Combine(local, "KnowledgeStarmap", "WebView2");
            this.kbConfigFile = Path.Combine(local, "KnowledgeStarmap", "kb-file.txt");
            this.kbPath = ReadKbPath();

            Text = "知识星图";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(900, 600);
            Size = new Size(1400, 900);
            BackColor = Color.FromArgb(5, 9, 18);
            try
            {
                string ico = Path.Combine(baseDir, "xintu.ico");
                if (File.Exists(ico)) Icon = new Icon(ico);
            }
            catch { }

            webView = new WebView2
            {
                Dock = DockStyle.Fill,
                DefaultBackgroundColor = Color.FromArgb(5, 9, 18)
            };
            Controls.Add(webView);
            Load += async (sender, args) => await InitAsync();
            Shown += (sender, args) => ApplyDarkTitleBar();
            FormClosing += OnFormClosing;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            ApplyDarkTitleBar();
        }

        private void ApplyDarkTitleBar()
        {
            IntPtr hwnd = Handle;
            if (hwnd == IntPtr.Zero) return;
            int dark = 1;
            if (DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int)) != 0)
                DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1, ref dark, sizeof(int));
            // Win11 22000+ 才支持下面三个属性，旧系统调用失败直接忽略。
            int caption = 0x00120905; // COLORREF 0x00BBGGRR → #050912，与网页顶栏同色
            int text = 0x00FFF7F2;    // #F2F7FF
            int border = 0x00120905;
            DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, ref caption, sizeof(int));
            DwmSetWindowAttribute(hwnd, DWMWA_TEXT_COLOR, ref text, sizeof(int));
            DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ref border, sizeof(int));
            SetWindowTheme(hwnd, "DarkMode_Explorer", null);
        }

        // 网页里按 F11 时通过 postMessage 通知壳程序切换全屏；Esc 只用于退出全屏。
        private const string FullscreenBridgeScript = @"
(function () {
  if (!window.chrome || !window.chrome.webview) return;
  window.addEventListener('keydown', function (e) {
    if (e.key === 'F11') {
      e.preventDefault();
      window.chrome.webview.postMessage('starmap:fullscreen');
    } else if (e.key === 'Escape') {
      window.chrome.webview.postMessage('starmap:escape');
    }
  }, true);
})();
";

        // 记住的知识文件路径（%LOCALAPPDATA%\KnowledgeStarmap\kb-file.txt 一行）。
        private string ReadKbPath()
        {
            try
            {
                if (File.Exists(kbConfigFile))
                {
                    string path = File.ReadAllText(kbConfigFile, Encoding.UTF8).Trim();
                    if (path.Length > 0) return path;
                }
            }
            catch { }
            return "";
        }

        private void WriteKbPath(string path)
        {
            try
            {
                string dir = Path.GetDirectoryName(kbConfigFile);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                if (path.Length > 0) File.WriteAllText(kbConfigFile, path, new UTF8Encoding(false));
                else if (File.Exists(kbConfigFile)) File.Delete(kbConfigFile);
            }
            catch { }
        }

        private void PostKbPlain(string text)
        {
            try { webView.CoreWebView2.PostWebMessageAsString(text); } catch { }
        }

        private void PostKbFile(string prefix, string path, string content)
        {
            try
            {
                webView.CoreWebView2.PostWebMessageAsString(prefix + "\n" + path + "\n" + content);
            }
            catch { }
        }

        // 页面启动时询问：有绑定文件就回传完整路径与内容。
        private void SendKbFile()
        {
            if (kbPath.Length == 0 || !File.Exists(kbPath))
            {
                PostKbPlain("starmap:kb-none");
                return;
            }
            try
            {
                PostKbFile("starmap:kb-loaded", kbPath, File.ReadAllText(kbPath, Encoding.UTF8));
            }
            catch
            {
                PostKbPlain("starmap:kb-error");
            }
        }

        // 原生文件对话框：路径在壳手里，页面拿到的是完整路径。
        private void PickKbFile()
        {
            using (var dialog = new OpenFileDialog())
            {
                dialog.Title = "选择知识文件";
                dialog.Filter = "知识库 JSON (*.json)|*.json|所有文件 (*.*)|*.*";
                dialog.CheckFileExists = true;
                if (kbPath.Length > 0)
                {
                    try { dialog.InitialDirectory = Path.GetDirectoryName(kbPath); } catch { }
                }
                if (dialog.ShowDialog(this) != DialogResult.OK)
                {
                    PostKbPlain("starmap:kb-cancel");
                    return;
                }
                try
                {
                    string content = File.ReadAllText(dialog.FileName, Encoding.UTF8);
                    kbPath = dialog.FileName;
                    WriteKbPath(kbPath);
                    PostKbFile("starmap:kb-picked", kbPath, content);
                }
                catch (Exception ex)
                {
                    MessageBox.Show("无法读取这个文件：\n" + ex.Message, "知识星图",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    PostKbPlain("starmap:kb-error");
                }
            }
        }

        private void SaveKbFile(string content)
        {
            if (kbPath.Length == 0) return;
            try
            {
                // 保持 UTF-8 无 BOM，和导出的 JSON 一致。
                File.WriteAllText(kbPath, content, new UTF8Encoding(false));
            }
            catch { }
        }

        // 新建空白知识库：用户自己挑保存位置，壳写盘后把路径回传给页面。
        private void CreateKbFile(string content)
        {
            using (var dialog = new SaveFileDialog())
            {
                dialog.Title = "新建知识库";
                dialog.Filter = "知识库 JSON (*.json)|*.json|所有文件 (*.*)|*.*";
                dialog.FileName = "我的知识库.json";
                dialog.OverwritePrompt = true;
                if (kbPath.Length > 0)
                {
                    try { dialog.InitialDirectory = Path.GetDirectoryName(kbPath); } catch { }
                }
                if (dialog.ShowDialog(this) != DialogResult.OK)
                {
                    PostKbPlain("starmap:kb-cancel");
                    return;
                }
                try
                {
                    File.WriteAllText(dialog.FileName, content, new UTF8Encoding(false));
                    kbPath = dialog.FileName;
                    WriteKbPath(kbPath);
                    PostKbFile("starmap:kb-created", kbPath, "");
                }
                catch (Exception ex)
                {
                    MessageBox.Show("无法写入这个文件：\n" + ex.Message, "知识星图",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    PostKbPlain("starmap:kb-error");
                }
            }
        }

        // 关闭窗口时，如果页面还有没保存的修改，交给网页里的确认框（与应用同一种深色风格）问一句。
        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (allowClose || !pageDirty || e.CloseReason == CloseReason.WindowsShutDown) return;

            // 先让网页弹出「保存并退出 / 放弃修改」；只有用户选择后才真正关闭。
            e.Cancel = true;
            if (AskPageToConfirmClose()) return;

            // 页面不可用时的兜底：退回系统对话框。
            DialogResult choice = MessageBox.Show(
                "有未保存的修改，退出会丢弃，确定退出吗？\n\n先点「否」回到窗口，按 Ctrl+S 保存。",
                "知识星图", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (choice == DialogResult.Yes)
            {
                allowClose = true;
                Close();
            }
        }

        private bool AskPageToConfirmClose()
        {
            try
            {
                if (webView == null || webView.CoreWebView2 == null) return false;
                webView.CoreWebView2.ExecuteScriptAsync(
                    "window.__starmapAskClose && window.__starmapAskClose()");
                return true;
            }
            catch
            {
                return false;
            }
        }

        private void UnbindKbFile()
        {
            kbPath = "";
            WriteKbPath("");
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string msg;
            try { msg = e.TryGetWebMessageAsString(); } catch { return; }
            if (msg == "starmap:fullscreen") ToggleFullscreen();
            else if (msg == "starmap:escape" && isFullscreen) ToggleFullscreen();
            else if (msg == "starmap:kb-get") SendKbFile();
            else if (msg == "starmap:kb-pick") PickKbFile();
            else if (msg == "starmap:kb-unbind") UnbindKbFile();
            else if (msg.StartsWith("starmap:dirty\n")) pageDirty = msg.EndsWith("1");
            else if (msg.StartsWith("starmap:close-confirmed"))
            {
                // 网页确认框里选择了「保存并退出」或「放弃修改」。
                allowClose = true;
                Close();
            }
            else if (msg.StartsWith(KbCreateCommand)) CreateKbFile(msg.Substring(KbCreateCommand.Length));
            else if (msg.StartsWith(KbSaveCommand)) SaveKbFile(msg.Substring(KbSaveCommand.Length));
        }

        private void ToggleFullscreen()
        {
            if (!isFullscreen)
            {
                savedBorderStyle = FormBorderStyle;
                savedWindowState = WindowState;
                savedBounds = Bounds;
                FormBorderStyle = FormBorderStyle.None;
                WindowState = FormWindowState.Normal;
                Bounds = Screen.FromControl(this).Bounds;
                isFullscreen = true;
            }
            else
            {
                FormBorderStyle = savedBorderStyle;
                Bounds = savedBounds;
                WindowState = savedWindowState;
                isFullscreen = false;
                ApplyDarkTitleBar();
            }
        }

        private async Task InitAsync()
        {
            try
            {
                // 允许页面在无手势时自动播放：等待页的星海底噪一打开就能响。
                CoreWebView2EnvironmentOptions envOptions = new CoreWebView2EnvironmentOptions
                {
                    AdditionalBrowserArguments = "--autoplay-policy=no-user-gesture-required"
                };
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userDataFolder, envOptions);
                await webView.EnsureCoreWebView2Async(env);
                webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
                await webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(FullscreenBridgeScript);
                webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
                webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                webView.CoreWebView2.Navigate(new Uri(htmlPath).AbsoluteUri);
                webView.Focus();
            }
            catch (Exception ex)
            {
                MessageBox.Show("启动失败：需要 Microsoft Edge WebView2 运行时。\n\n" + ex.Message,
                    "知识星图", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                Close();
            }
        }
    }
}