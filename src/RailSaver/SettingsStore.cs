using System.Text.Json;
using System.Text.Json.Nodes;

namespace RailSaver;

/// <summary>
/// Settings are a flat JSON object owned by the web page (web/js/settings.js
/// lists the keys and defaults). The host stores it as-is and only reads the
/// few keys it needs itself.
/// </summary>
internal static class SettingsStore
{
    public static JsonObject Load()
    {
        try
        {
            if (File.Exists(Paths.SettingsFile) && JsonNode.Parse(File.ReadAllText(Paths.SettingsFile)) is JsonObject o)
                return o;
        }
        catch (Exception ex) { Log.Error("Reading settings", ex); }
        return new JsonObject();
    }

    public static void Save(JsonElement settings)
    {
        if (settings.ValueKind != JsonValueKind.Object) return;
        try
        {
            string tmp = Paths.SettingsFile + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(tmp, Paths.SettingsFile, overwrite: true);
            Log.Info("Settings saved");
        }
        catch (Exception ex) { Log.Error("Saving settings", ex); }
    }

    /// <summary>Script that hands the saved settings to the page before it runs.</summary>
    public static string InjectionScript() => $"window.RAILSAVER_SETTINGS = {Load().ToJsonString()};";

    public static bool GetBool(string key, bool fallback)
    {
        try { return Load()[key]?.GetValue<bool>() ?? fallback; }
        catch { return fallback; }
    }

    public static string Get(string key, string fallback)
    {
        try { return Load()[key]?.GetValue<string>() ?? fallback; }
        catch { return fallback; }
    }
}
