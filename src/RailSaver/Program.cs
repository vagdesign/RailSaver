using Microsoft.Web.WebView2.Core;

namespace RailSaver;

/// <summary>
/// Windows screen saver entry point. Windows starts a .scr with:
///   /s            run full screen
///   /p &lt;hwnd&gt;     draw the small preview inside the Screen Saver Settings dialog
///   /c[:hwnd]     show the settings (also: no arguments, e.g. a double-click)
/// Extra, for testing: /w runs the clock in an ordinary resizable window.
/// </summary>
internal static class Program
{
    public const string Host = "railsaver.local";
    public static bool DevTools;

    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Log.Error("UI thread", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Error("Unhandled", e.ExceptionObject as Exception);

        if (args.Any(a => a.Equals("--update", StringComparison.OrdinalIgnoreCase)))
            return UpdateService.RunBackgroundAsync().GetAwaiter().GetResult();

        var (mode, hwnd) = ParseArgs(args);
        DevTools = args.Any(a => a.Equals("--devtools", StringComparison.OrdinalIgnoreCase));
        Log.Info($"RailSaver {Version} {string.Join(' ', args)} -> {mode}");

        switch (mode)
        {
            case 's':
                Application.Run(new SaverContext());
                break;
            case 'p':
                if (hwnd == IntPtr.Zero) return 1;
                Application.Run(new PreviewWindow(hwnd));
                break;
            case 'w':
                Application.Run(new SaverWindow(Screen.PrimaryScreen!, windowed: true, audio: true));
                break;
            default:
                Application.Run(new SettingsWindow(hwnd));
                break;
        }
        return 0;
    }

    /// <summary>"/p 1234", "/p:1234", "-c:1234", "/S" ... → mode letter and window handle.</summary>
    internal static (char mode, IntPtr hwnd) ParseArgs(string[] args)
    {
        if (args.Length == 0) return ('c', IntPtr.Zero);
        string a = args[0].Trim().TrimStart('/', '-').ToLowerInvariant();
        if (a.Length == 0) return ('c', IntPtr.Zero);
        char mode = a[0];
        if (a.StartsWith("window")) mode = 'w';
        if ("spcw".IndexOf(mode) < 0) mode = 'c';
        string? num = null;
        int colon = a.IndexOf(':');
        if (colon >= 0) num = a[(colon + 1)..];
        else if (args.Length > 1) num = args[1];
        IntPtr hwnd = IntPtr.Zero;
        if (num != null && long.TryParse(num.Trim(), out long v)) hwnd = new IntPtr(v);
        return (mode, hwnd);
    }

    public static string Version =>
        typeof(Program).Assembly.GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "0.0.0";

    public static string WebFolder => Path.Combine(AppContext.BaseDirectory, "web");

    private static Task<CoreWebView2Environment>? _env;

    /// <summary>One shared WebView2 browser process for all windows.</summary>
    public static Task<CoreWebView2Environment> WebEnvironment()
    {
        return _env ??= CoreWebView2Environment.CreateAsync(null, Paths.WebViewData, new CoreWebView2EnvironmentOptions
        {
            // The release sound must play without a click first.
            AdditionalBrowserArguments = "--autoplay-policy=no-user-gesture-required --disable-features=CalculateNativeWinOcclusion",
        });
    }

    public static bool WebViewAvailable()
    {
        try { return !string.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString()); }
        catch { return false; }
    }

    public static Icon AppIcon
    {
        get
        {
            using var s = typeof(Program).Assembly.GetManifestResourceStream("RailSaver.ico");
            return s != null ? new Icon(s) : SystemIcons.Application;
        }
    }
}

internal static class Paths
{
    public static string Data
    {
        get
        {
            string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RailSaver");
            Directory.CreateDirectory(d);
            return d;
        }
    }
    public static string WebViewData => Path.Combine(Data, "WebView2");
    public static string SettingsFile
    {
        get
        {
            string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RailSaver");
            Directory.CreateDirectory(d);
            return Path.Combine(d, "settings.json");
        }
    }
}

internal static class Log
{
    private static readonly object Gate = new();
    private static string File => Path.Combine(Paths.Data, "RailSaver.log");

    public static void Info(string msg) => Write("INFO ", msg);
    public static void Error(string msg, Exception? ex) => Write("ERROR", ex == null ? msg : $"{msg}: {ex}");

    private static void Write(string level, string msg)
    {
        try
        {
            lock (Gate)
            {
                var fi = new FileInfo(File);
                if (fi.Exists && fi.Length > 1_000_000) fi.Delete();
                System.IO.File.AppendAllText(File, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {level} [{Environment.ProcessId}] {msg}{Environment.NewLine}");
            }
        }
        catch { /* logging must never break the saver */ }
    }
}
