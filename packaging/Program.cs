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
        private readonly string htmlPath;
        private bool isFullscreen;
        private FormBorderStyle savedBorderStyle;
        private FormWindowState savedWindowState;
        private Rectangle savedBounds;

        public MainForm(string baseDir, string htmlPath)
        {
            this.htmlPath = htmlPath;
            this.userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "KnowledgeStarmap", "WebView2");

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