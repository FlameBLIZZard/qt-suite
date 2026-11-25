// QT Suite.exe - starts the hub on the Python that ships next to it.
// Built by packaging\build.ps1 with the C# compiler that comes with Windows (.NET Framework 4).
// Arguments pass straight through to suite\app.py (for example --no-window at sign-in).
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("QT Suite")]
[assembly: AssemblyProduct("QT Suite")]
[assembly: AssemblyDescription("Small, loud, offline tools for your PC and phone")]
[assembly: AssemblyCompany("FlameBLIZZard and contributors")]
[assembly: AssemblyCopyright("Copyright (c) 2026 FlameBLIZZard and contributors. MIT licence.")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class QTSuite
{
    [STAThread]
    static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string pyw = Path.Combine(root, "runtime", "pythonw.exe");
        string app = Path.Combine(root, "suite", "app.py");
        if (!File.Exists(pyw) || !File.Exists(app))
        {
            MessageBox.Show("QT Suite is missing some of its files.\n\nPlease reinstall it from the latest release.",
                "QT Suite", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        var psi = new ProcessStartInfo(pyw)
        {
            Arguments = "\"" + app + "\"" + string.Concat(args.Select(a => " \"" + a.Replace("\"", "") + "\"")),
            WorkingDirectory = Path.Combine(root, "suite"),
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        // keep the bundled Python to itself: no packages or paths from another Python on this PC
        psi.EnvironmentVariables["PYTHONNOUSERSITE"] = "1";
        psi.EnvironmentVariables["PYTHONUTF8"] = "1";
        psi.EnvironmentVariables.Remove("PYTHONPATH");
        psi.EnvironmentVariables.Remove("PYTHONHOME");
        psi.EnvironmentVariables.Remove("PYTHONSTARTUP");
        psi.EnvironmentVariables["QT_SUITE_INSTALLED"] = "1";
        try { Process.Start(psi); }
        catch (Exception e)
        {
            MessageBox.Show("QT Suite couldn't start:\n\n" + e.Message, "QT Suite", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        return 0;
    }
}
