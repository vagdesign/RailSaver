using System.Drawing.Drawing2D;

namespace RailSaver;

/// <summary>
/// A flat GDI+ drawing of the clock with the same stop-to-go movement. Used for
/// the tiny preview in the Screen Saver Settings dialog, and full screen when
/// the WebView2 runtime is missing.
/// </summary>
internal static class ClockPainter
{
    private static readonly Color Red = Color.FromArgb(212, 21, 27);
    private static readonly Color Ink = Color.FromArgb(14, 14, 15);

    public static void Paint(Graphics g, Rectangle bounds, DateTime now, double stopSeconds, Color background)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(background);
        float d = Math.Min(bounds.Width, bounds.Height) * 0.86f;
        float cx = bounds.X + bounds.Width / 2f, cy = bounds.Y + bounds.Height / 2f;
        float R = d / 2f / 1.13f;   // dial radius, as in web/js/clock.js

        // Steel case and bezel.
        var caseRect = new RectangleF(cx - R * 1.13f, cy - R * 1.13f, R * 2.26f, R * 2.26f);
        using (var b = new LinearGradientBrush(caseRect, Color.FromArgb(235, 238, 241), Color.FromArgb(110, 114, 120), 60f))
            g.FillEllipse(b, caseRect);
        using (var b = new SolidBrush(Color.FromArgb(244, 244, 241)))
            g.FillEllipse(b, cx - R * 1.02f, cy - R * 1.02f, R * 2.04f, R * 2.04f);

        g.TranslateTransform(cx, cy);
        using (var ink = new SolidBrush(Ink))
        {
            for (int i = 0; i < 60; i++)
            {
                var st = g.Save();
                g.RotateTransform(i * 6);
                if (i % 5 == 0) g.FillRectangle(ink, -0.037f * R, -0.945f * R, 0.074f * R, 0.24f * R);
                else g.FillRectangle(ink, -0.012f * R, -0.945f * R, 0.024f * R, 0.07f * R);
                g.Restore(st);
            }

            // Same movement as web/js/motion.js (without the spring).
            double stop = Math.Clamp(stopSeconds, 0, 10), sweep = 60 - stop;
            double s = now.Second + now.Millisecond / 1000.0;
            double sec = stop == 0 ? s * 6 : s < sweep ? 360 * s / sweep : 0;
            double min = now.Minute * 6;
            double hour = (now.Hour % 12) * 30 + now.Minute * 0.5;

            Hand(g, ink, hour, 0.25f * R, 0.64f * R, 0.112f * R, 0.086f * R);
            Hand(g, ink, min, 0.24f * R, 0.925f * R, 0.094f * R, 0.064f * R);
            using var red = new SolidBrush(Red);
            var st2 = g.Save();
            g.RotateTransform((float)sec);
            g.FillRectangle(red, -0.012f * R, -0.56f * R, 0.024f * R, 0.89f * R);
            g.FillEllipse(red, -0.103f * R, -0.718f * R, 0.206f * R, 0.206f * R);
            g.FillEllipse(red, -0.034f * R, -0.034f * R, 0.068f * R, 0.068f * R);
            g.Restore(st2);
        }
        g.ResetTransform();
    }

    private static void Hand(Graphics g, Brush b, double angle, float tail, float tip, float w0, float w1)
    {
        var st = g.Save();
        g.RotateTransform((float)angle);
        g.FillPolygon(b, new[]
        {
            new PointF(-w0 / 2, tail), new PointF(w0 / 2, tail), new PointF(w1 / 2, -tip), new PointF(-w1 / 2, -tip),
        });
        g.Restore(st);
    }
}
