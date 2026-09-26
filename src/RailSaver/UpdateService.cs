using System.Diagnostics;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace RailSaver;

/// <summary>
/// Updates from GitHub Releases (as in 3D Earth): finds a newer
/// RailSaver-Setup-x.y.z.exe, downloads it, verifies its size and SHA-256 and
/// runs it silently. Your settings and the active-screen-saver choice are kept.
/// </summary>
internal static class UpdateService
{
    public const string FeedRepo = "vagdesign/RailSaver";
    private const string AppId = "{5E2B7C41-9A3D-4F6B-8C1E-2D7A9B3E4F50}";
    private static readonly TimeSpan Interval = TimeSpan.FromHours(12);

    public sealed record Release(Version Version, string Url, string Name, long Size, string? Sha256, string PageUrl);

    public static Version Current =>
        typeof(Program).Assembly.GetName().Version is { } v ? new Version(v.Major, v.Minor, Math.Max(0, v.Build)) : new Version(0, 0, 0);

    private static HttpClient NewClient()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("RailSaver", Current.ToString(3)));
        http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        return http;
    }

    /// <summary>The newest release if it is newer than this copy, else null.</summary>
    public static async Task<Release?> CheckAsync()
    {
        using var http = NewClient();
        var root = JsonNode.Parse(await http.GetStringAsync($"https://api.github.com/repos/{FeedRepo}/releases/latest"));
        string tag = root?["tag_name"]?.ToString() ?? "";
        if (!Version.TryParse(tag.TrimStart('v', 'V'), out var v)) return null;
        v = new Version(v.Major, v.Minor, Math.Max(0, v.Build));
        var asset = (root?["assets"] as JsonArray)?.FirstOrDefault(a =>
        {
            string n = a?["name"]?.ToString() ?? "";
            return n.StartsWith("RailSaver-Setup-", StringComparison.OrdinalIgnoreCase) && n.EndsWith(".exe", StringComparison.OrdinalIgnoreCase);
        });
        if (v <= Current || asset == null) return null;
        string? digest = asset["digest"]?.ToString();
        return new Release(v, asset["browser_download_url"]!.ToString(), asset["name"]!.ToString(),
            asset["size"]?.GetValue<long>() ?? 0,
            digest != null && digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase) ? digest[7..] : null,
            root?["html_url"]?.ToString() ?? $"https://github.com/{FeedRepo}/releases/latest");
    }

    /// <summary>True when this copy came from the installer (the portable zip does not update itself).</summary>
    public static bool IsInstalled
    {
        get
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey($@"Software\Microsoft\Windows\CurrentVersion\Uninstall\{AppId}_is1");
                string? dir = key?.GetValue("InstallLocation") as string;
                return dir != null && AppContext.BaseDirectory.StartsWith(Path.GetFullPath(dir), StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }
    }

    /// <summary>Downloads and verifies the installer; returns its path.</summary>
    public static async Task<string> DownloadAsync(Release r, IProgress<int>? progress = null)
    {
        string dir = Path.Combine(Path.GetTempPath(), "RailSaver-Update");
        Directory.CreateDirectory(dir);
        string file = Path.Combine(dir, r.Name);
        using var http = NewClient();
        using (var resp = await http.GetAsync(r.Url, HttpCompletionOption.ResponseHeadersRead))
        {
            resp.EnsureSuccessStatusCode();
            long total = resp.Content.Headers.ContentLength ?? r.Size;
            await using var src = await resp.Content.ReadAsStreamAsync();
            await using var dst = File.Create(file);
            var buffer = new byte[81920];
            long done = 0;
            int n;
            while ((n = await src.ReadAsync(buffer)) > 0)
            {
                await dst.WriteAsync(buffer.AsMemory(0, n));
                done += n;
                if (total > 0) progress?.Report((int)(done * 100 / total));
            }
        }
        if (r.Size > 0 && new FileInfo(file).Length != r.Size) throw new InvalidDataException("the download has the wrong size");
        if (r.Sha256 != null)
        {
            await using var fs = File.OpenRead(file);
            string hash = Convert.ToHexString(await SHA256.HashDataAsync(fs));
            if (!hash.Equals(r.Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("checksum mismatch");
        }
        return file;
    }

    /// <summary>
    /// Runs the installer after a short delay (so this process can exit first).
    /// '!setactive' keeps the user's own screen-saver choice.
    /// </summary>
    public static void RunInstaller(string file, bool showProgress)
    {
        string mode = showProgress ? "/SILENT" : "/VERYSILENT";
        string args = $"/C timeout /T 2 /NOBREAK >NUL & \"{file}\" {mode} /SUPPRESSMSGBOXES /NORESTART /SP- /MERGETASKS=\"!setactive\"";
        Process.Start(new ProcessStartInfo("cmd.exe", args) { UseShellExecute = false, CreateNoWindow = true });
        Log.Info($"Installer started: {file}");
    }

    // ---- automatic updates (screen saver start → background process) ----

    private static string StampFile => Path.Combine(Paths.Data, "last-update-check.txt");

    /// <summary>Called when the screen saver starts: at most every 12 hours, check in a background process.</summary>
    public static void MaybeStartBackgroundCheck()
    {
        try
        {
            if (!IsInstalled || !SettingsStore.GetBool("autoUpdate", true)) return;
            if (File.Exists(StampFile) && DateTime.UtcNow - File.GetLastWriteTimeUtc(StampFile) < Interval) return;
            File.WriteAllText(StampFile, DateTime.UtcNow.ToString("o"));
            string exe = Path.Combine(AppContext.BaseDirectory, "RailSaver.exe");
            Process.Start(new ProcessStartInfo(exe, "--update") { UseShellExecute = false, CreateNoWindow = true });
        }
        catch (Exception ex) { Log.Error("Starting the update check", ex); }
    }

    /// <summary>--update: check, download, wait until no screen saver runs, install silently.</summary>
    public static async Task<int> RunBackgroundAsync()
    {
        try
        {
            var r = await CheckAsync();
            if (r == null) { Log.Info("Update check: up to date"); return 0; }
            Log.Info($"Update check: {r.Version} available, downloading");
            string file = await DownloadAsync(r);
            // Wait (up to 3 hours) until the screen saver and the settings are closed.
            int me = Environment.ProcessId;
            for (int i = 0; i < 360; i++)
            {
                if (!Process.GetProcessesByName("RailSaver").Any(p => p.Id != me)) break;
                await Task.Delay(TimeSpan.FromSeconds(30));
            }
            RunInstaller(file, showProgress: false);
            return 0;
        }
        catch (Exception ex)
        {
            Log.Error("Background update", ex);
            return 1;
        }
    }
}
