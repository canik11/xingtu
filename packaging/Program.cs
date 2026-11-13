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
        // 页面 → 壳：纯文本协议，避免 JSON 转义；路径与内容用换行分隔。
        private const string KbSaveCommand = "starmap:kb-save\n";
        private readonly WebView2 webView;
        private readonly string userDataFolder;
        private readonly string kbConfigFile;
        private readonly string htmlPath;
        private string kbPath;
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
            }
        }

        private async Task InitAsync()
        {
            try
            {
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
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