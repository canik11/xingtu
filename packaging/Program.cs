using System;
using System.Drawing;
using System.IO;
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
        private readonly WebView2 webView;
        private readonly string userDataFolder;
        private readonly string dataDirFile;
        private readonly string htmlPath;
        private bool isFullscreen;
        private FormBorderStyle savedBorderStyle;
        private FormWindowState savedWindowState;
        private Rectangle savedBounds;

        public MainForm(string baseDir, string htmlPath)
        {
            this.htmlPath = htmlPath;
            this.dataDirFile = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "KnowledgeStarmap", "data-dir.txt");
            this.userDataFolder = ResolveDataDir(this.dataDirFile);

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

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string msg;
            try { msg = e.TryGetWebMessageAsString(); } catch { return; }
            if (msg == "starmap:fullscreen") ToggleFullscreen();
            else if (msg == "starmap:escape" && isFullscreen) ToggleFullscreen();
            else if (msg == "starmap:get-data-dir") SendDataDir();
            else if (msg == "starmap:pick-data-dir") PickDataDir();
        }

        private static string DefaultDataDir()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "KnowledgeStarmap", "WebView2");
        }

        // 默认放在 %LOCALAPPDATA%；用户改过 data-dir.txt 时用用户指定的目录。
        private static string ResolveDataDir(string dataDirFile)
        {
            try
            {
                if (File.Exists(dataDirFile))
                {
                    string dir = File.ReadAllText(dataDirFile).Trim();
                    if (dir.Length > 0) return dir;
                }
            }
            catch { }
            return DefaultDataDir();
        }

        private void SendDataDir()
        {
            try
            {
                webView.CoreWebView2.PostWebMessageAsString("starmap:data-dir:" + userDataFolder);
            }
            catch { }
        }

        private void PickDataDir()
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = "选择知识星图的数据目录。切换后需要重启，旧目录里的内容不会自动迁移。";
                dialog.SelectedPath = userDataFolder;
                dialog.ShowNewFolderButton = true;
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                string dir = dialog.SelectedPath;
                if (string.IsNullOrEmpty(dir)) return;
                try
                {
                    Directory.CreateDirectory(dir);
                    Directory.CreateDirectory(Path.GetDirectoryName(dataDirFile));
                    File.WriteAllText(dataDirFile, dir);
                }
                catch (Exception ex)
                {
                    MessageBox.Show("无法使用这个目录：\n" + ex.Message, "知识星图",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                DialogResult answer = MessageBox.Show(
                    "数据目录已改为：\n" + dir +
                    "\n\n重启后生效。旧目录里的数据不会自动搬迁；如果里面有内容，请先在旧窗口「导出数据」，重启后再导入。\n\n现在重启吗？",
                    "知识星图", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (answer == DialogResult.Yes) Application.Restart();
            }
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