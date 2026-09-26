using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RailSaver;

/// <summary>/c: the settings page (web/settings.html) with a live 3D preview.</summary>
internal sealed class SettingsWindow : Form
{
    private readonly WebView2 _web;

    /// <param name="owner">The Screen Saver Settings dialog (unused: the window stays independent).</param>
    public SettingsWindow(IntPtr owner)
    {
        Text = "RailSaver Settings";
        Icon = Program.AppIcon;
        BackColor = Color.FromArgb(21, 23, 26);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        var area = Screen.FromPoint(Cursor.Position).WorkingArea;
        Size = new Size(Math.Min(LogicalToDeviceUnits(1240), area.Width - 40), Math.Min(LogicalToDeviceUnits(820), area.Height - 40));
        MinimumSize = new Size(LogicalToDeviceUnits(720), LogicalToDeviceUnits(520));
        _web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
        Controls.Add(_web);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (!Program.WebViewAvailable())
        {
            var r = MessageBox.Show(this,
                "RailSaver needs the Microsoft Edge WebView2 Runtime, which was not found on this PC.\n\nOpen the download page now?",
                "RailSaver", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (r == DialogResult.Yes)
                Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true });
            Close();
            return;
        }
        try
        {
            var env = await Program.WebEnvironment();
            await _web.EnsureCoreWebView2Async(env);
            var core = _web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = Program.DevTools;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = Program.DevTools;
            core.SetVirtualHostNameToFolderMapping(Program.Host, Program.WebFolder, CoreWebView2HostResourceAccessKind.Allow);
            await core.AddScriptToExecuteOnDocumentCreatedAsync(SettingsStore.InjectionScript());
            core.WebMessageReceived += OnWebMessage;
            // Links (GitHub) open in the default browser.
            core.NewWindowRequested += (_, a) =>
            {
                a.Handled = true;
                if (a.Uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    Process.Start(new ProcessStartInfo(a.Uri) { UseShellExecute = true });
            };
            core.Navigate($"https://{Program.Host}/settings.html?version={Program.Version}");
        }
        catch (Exception ex)
        {
            Log.Error("Settings WebView2", ex);
            MessageBox.Show(this, "The settings page could not be opened:\n" + ex.Message, "RailSaver", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var type)) return;
            switch (type.GetString())
            {
                case "save":
                    if (root.TryGetProperty("settings", out var s)) SettingsStore.Save(s);
                    break;
                case "close":
                    BeginInvoke(Close);
                    break;
                case "installUpdate":
                    _ = InstallUpdateAsync();
                    break;
                case "log":
                    Log.Info("settings page: " + (root.TryGetProperty("message", out var m) ? m.GetString() : ""));
                    break;
            }
        }
        catch (Exception ex) { Log.Error("Settings message", ex); }
    }

    private void Status(string text, bool failed = false)
    {
        try { _web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "updateStatus", text, failed })); }
        catch { /* window closing */ }
    }

    /// <summary>Settings → Install update: download, verify, run the installer (it keeps the settings), close.</summary>
    private async Task InstallUpdateAsync()
    {
        try
        {
            var r = await UpdateService.CheckAsync();
            if (r == null) { Status("RailSaver is up to date."); return; }
            if (!UpdateService.IsInstalled)
            {
                Status("This copy is portable (not installed): opening the download page.");
                Process.Start(new ProcessStartInfo(r.PageUrl) { UseShellExecute = true });
                return;
            }
            var progress = new Progress<int>(p => Status($"Downloading {r.Version}… {p}%"));
            string file = await UpdateService.DownloadAsync(r, progress);
            Status($"Installing {r.Version}…");
            UpdateService.RunInstaller(file, showProgress: true);
            await Task.Delay(800);
            Application.Exit();
        }
        catch (Exception ex)
        {
            Log.Error("Installing update", ex);
            Status("Update failed: " + ex.Message, failed: true);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _web.Dispose();
        base.Dispose(disposing);
    }
}
