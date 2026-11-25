// QT Suite file opener. Windows runs this when you double-click a file that QT Suite is the default for:
//   QTOpen.exe <app> "<file>"      app = pictures | player | reader | code | archive
// It wakes the hub if it's asleep (pythonw app.py --no-window), then opens the file in its own
// viewer window: http://127.0.0.1:7800/tool/<app>?open=<file>. Built by defaults.py (csc, no SDK needed).
using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("QT Suite")]
[assembly: AssemblyProduct("QT Suite")]
[assembly: AssemblyDescription("QT Suite file viewer")]
[assembly: AssemblyVersion("1.0.0.0")]

static class QTOpen
{
    const int Port = 7800;
    static readonly string[] Apps = { "pictures", "player", "reader", "code", "archive" };

    static bool Up()
    {
        try { using (var c = new TcpClient()) { var r = c.BeginConnect("127.0.0.1", Port, null, null); return r.AsyncWaitHandle.WaitOne(250) && c.Connected; } }
        catch { return false; }
    }

    static string Ini(string key)
    {
        string f = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "qtopen.ini");
        if (!File.Exists(f)) return null;
        foreach (var line in File.ReadAllLines(f))
        {
            int i = line.IndexOf('=');
            if (i > 0 && line.Substring(0, i).Trim() == key) return line.Substring(i + 1).Trim();
        }
        return null;
    }

    [STAThread]
    static int Main(string[] args)
    {
        string app = args.Length > 0 ? args[0].ToLowerInvariant() : "code";
        if (Array.IndexOf(Apps, app) < 0) app = "code";
        string file = args.Length > 1 ? Path.GetFullPath(args[1]) : "";

        if (!Up())
        {
            string pyw = Ini("pythonw"), hub = Ini("app");
            if (string.IsNullOrEmpty(pyw) || !File.Exists(pyw) || string.IsNullOrEmpty(hub) || !File.Exists(hub))
            {
                MessageBox.Show("QT Suite isn't installed where it used to be. Open QT Suite once and turn \"Default apps\" on again in Settings.",
                    "QT Suite", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
            Process.Start(new ProcessStartInfo(pyw, "\"" + hub + "\" --no-window") { WorkingDirectory = Path.GetDirectoryName(hub), UseShellExecute = false });
            for (int i = 0; i < 80 && !Up(); i++) Thread.Sleep(150);   // up to 12 s
        }

        string url = "http://127.0.0.1:" + Port + "/tool/" + app + (file.Length > 0 ? "?open=" + Uri.EscapeDataString(file) : "");
        foreach (var edge in new[] { @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", @"C:\Program Files\Microsoft\Edge\Application\msedge.exe" })
        {
            if (File.Exists(edge))
            {
                Process.Start(new ProcessStartInfo(edge, "--app=" + url + " --window-size=1280,860") { UseShellExecute = false });
                return 0;
            }
        }
        Process.Start(url);
        return 0;
    }
}
