using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RailSaver;

/// <summary>/s: one full-screen window per monitor; the first input closes them all.</summary>
internal sealed class SaverContext : ApplicationContext
{
    public SaverContext()
    {
        bool primaryOnly = SettingsStore.Get("monitors", "all") == "primary";
        var screens = Screen.AllScreens;
        foreach (var screen in screens)
        {
            Form f = screen.Primary || !primaryOnly
                ? new SaverWindow(screen, windowed: false, audio: screen.Primary || screens.All(s => !s.Primary))
                : new BlankWindow(screen);
            f.FormClosed += (_, _) => ExitThread();
            f.Show();
        }
        Cursor.Hide();
        UpdateService.MaybeStartBackgroundCheck();
    }
}

/// <summary>Black cover for monitors without a clock.</summary>
internal sealed class BlankWindow : Form
{
    public BlankWindow(Screen screen)
    {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = screen.Bounds;
        BackColor = Color.Black;
        ShowInTaskbar = false;
        TopMost = true;
        KeyPreview = true;
        KeyDown += (_, _) => Application.Exit();
        MouseDown += (_, _) => Application.Exit();
    }
}

/// <summary>Hosts the WebGL clock (web/index.html) in WebView2.</summary>
internal sealed class SaverWindow : Form
{
    private readonly WebView2 _web;
    private readonly bool _windowed;
    private readonly bool _audio;
    private readonly System.Windows.Forms.Timer _inputTimer = new() { Interval = 100 };
    private Point _cursorStart;
    private DateTime _armAt;
    private bool _fallback;

    public SaverWindow(Screen screen, bool windowed, bool audio)
    {
        _windowed = windowed;
        _audio = audio;
        Text = "RailSaver";
        Icon = Program.AppIcon;
        BackColor = Color.Black;
        AutoScaleMode = AutoScaleMode.None;
        DoubleBuffered = true;
        KeyPreview = true;
        if (windowed)
        {
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(Math.Min(1280, screen.WorkingArea.Width - 80), Math.Min(800, screen.WorkingArea.Height - 80));
        }
        else
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Bounds = screen.Bounds;
            ShowInTaskbar = false;
            TopMost = true;
        }

        _web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black, Visible = false };
        Controls.Add(_web);

        if (!windowed)
        {
            // Input ends the screen saver. Keys and clicks come from the page (it
            // has the focus); mouse movement is watched here, which also covers
            // the moments before the page has loaded.
            KeyDown += (_, _) => Quit("key");
            MouseDown += (_, _) => Quit("click");
            _inputTimer.Tick += (_, _) =>
            {
                if (DateTime.UtcNow < _armAt) { _cursorStart = Cursor.Position; return; }
                var p = Cursor.Position;
                if (Math.Abs(p.X - _cursorStart.X) + Math.Abs(p.Y - _cursorStart.Y) > 14) Quit("mouse");
            };
        }
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        _armAt = DateTime.UtcNow.AddSeconds(0.8);
        _cursorStart = Cursor.Position;
        if (!_windowed) { _inputTimer.Start(); Activate(); }

        if (!Program.WebViewAvailable())
        {
            Log.Error("WebView2 runtime not found; drawing the flat clock", null);
            StartFallback();
            return;
        }
        try
        {
            var env = await Program.WebEnvironment();
            await _web.EnsureCoreWebView2Async(env);
            var core = _web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = Program.DevTools;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = Program.DevTools;
            core.SetVirtualHostNameToFolderMapping(Program.Host, Program.WebFolder, CoreWebView2HostResourceAccessKind.Allow);
            await core.AddScriptToExecuteOnDocumentCreatedAsync(SettingsStore.InjectionScript());
            core.WebMessageReceived += OnWebMessage;
            core.ProcessFailed += (_, a) =>
            {
                Log.Error($"WebView2 process failed: {a.ProcessFailedKind}", null);
                if (a.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) BeginInvoke(StartFallback);
            };
            core.NavigationCompleted += (_, a) =>
            {
                if (!a.IsSuccess) Log.Error($"Navigation failed: {a.WebErrorStatus}", null);
                _web.Visible = true;
                _web.Focus();
            };
            string mode = _windowed ? "window" : "screensaver";
            core.Navigate($"https://{Program.Host}/index.html?mode={mode}&audio={(_audio ? 1 : 0)}");
        }
        catch (Exception ex)
        {
            Log.Error("Starting WebView2", ex);
            StartFallback();
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
                case "exit":
                    if (!_windowed) Quit("page input");
                    break;
                case "log":
                    Log.Info("page: " + (root.TryGetProperty("message", out var m) ? m.GetString() : ""));
                    break;
            }
        }
        catch (Exception ex) { Log.Error("Web message", ex); }
    }

    // ---- flat fallback (no WebView2) ----
    private System.Windows.Forms.Timer? _paintTimer;

    private void StartFallback()
    {
        if (_fallback) return;
        _fallback = true;
        _web.Visible = false;
        _paintTimer = new System.Windows.Forms.Timer { Interval = 33 };
        _paintTimer.Tick += (_, _) => Invalidate();
        _paintTimer.Start();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (!_fallback) return;
        double stop = 6;
        try { stop = SettingsStore.Load()["stopSeconds"]?.GetValue<double>() ?? 6; } catch { }
        ClockPainter.Paint(e.Graphics, ClientRectangle, DateTime.Now, stop, Color.FromArgb(10, 10, 12));
        using var f = new Font("Segoe UI", 10f);
        TextRenderer.DrawText(e.Graphics, "Install the Microsoft Edge WebView2 Runtime for the 3D clock.", f,
            new Point(16, ClientSize.Height - 30), Color.FromArgb(120, 120, 128));
    }

    private void Quit(string why)
    {
        if (_windowed || DateTime.UtcNow < _armAt) return;
        Log.Info($"Exit ({why})");
        _inputTimer.Stop();
        Application.Exit();
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (_windowed && keyData == Keys.Escape) { Close(); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { _inputTimer.Dispose(); _paintTimer?.Dispose(); _web.Dispose(); }
        base.Dispose(disposing);
    }
}

/// <summary>/p: the small live preview inside the Screen Saver Settings dialog.</summary>
internal sealed class PreviewWindow : Form
{
    private readonly IntPtr _parent;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 40 };
    private readonly double _stop;

    public PreviewWindow(IntPtr parent)
    {
        _parent = parent;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        BackColor = Color.Black;
        try { _stop = SettingsStore.Load()["stopSeconds"]?.GetValue<double>() ?? 6; } catch { _stop = 6; }
        _timer.Tick += (_, _) =>
        {
            if (!NativeMethods.IsWindow(_parent) || !NativeMethods.IsWindowVisible(_parent)) { Close(); return; }
            Invalidate();
        };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Become a child of the dialog's little monitor picture.
        NativeMethods.SetParent(Handle, _parent);
        long style = NativeMethods.GetWindowLongPtr(Handle, NativeMethods.GWL_STYLE).ToInt64();
        style = (style | NativeMethods.WS_CHILD) & ~NativeMethods.WS_POPUP;
        NativeMethods.SetWindowLongPtr(Handle, NativeMethods.GWL_STYLE, new IntPtr(style));
        NativeMethods.GetClientRect(_parent, out var r);
        Bounds = new Rectangle(0, 0, r.Right - r.Left, r.Bottom - r.Top);
        _timer.Start();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        ClockPainter.Paint(e.Graphics, ClientRectangle, DateTime.Now, _stop, Color.FromArgb(12, 12, 14));
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _timer.Dispose();
        base.Dispose(disposing);
    }
}
