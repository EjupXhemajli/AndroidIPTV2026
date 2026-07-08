using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Threading;
using ExIptvDesktop.Services;
using LibVLCSharp.Shared;

namespace ExIptvDesktop;

public partial class App : Application
{
    // Zentrale, eindeutige LibVLC-Instanz. Mehrfach-Initialisierung ist teuer
    // und in einigen libvlc-Versionen nicht thread-sicher -> immer wiederverwenden.
    public static LibVLC? SharedLibVlc { get; private set; }
    public static string AppDataRoot { get; private set; } = string.Empty;

    private FileLogger? _logger;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Windows-1252/Legacy-Codepages verfuegbar machen (fuer PlaylistTypeDetector-Fallback).
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        AppDataRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ExIptvDesktop");
        Directory.CreateDirectory(AppDataRoot);
        Directory.CreateDirectory(Path.Combine(AppDataRoot, "logs"));
        Directory.CreateDirectory(Path.Combine(AppDataRoot, "cache"));

        _logger = new FileLogger(Path.Combine(AppDataRoot, "logs"));
        _logger.Info("App", "Startup begonnen.");

        // Globales Fehlerhandling: keine Abstuerze, alles wird geloggt.
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            _logger.Critical("AppDomain", $"Unhandled: {args.ExceptionObject}");

        DispatcherUnhandledException += (_, args) =>
        {
            _logger!.Error("Dispatcher", args.Exception.ToString());
            // UI-Thread-Fehler abfangen statt die App abstuerzen zu lassen.
            args.Handled = true;
        };

        TaskSchedulerLogging.Register(_logger);

        try
        {
            Core.Initialize();
            // -vv nur bei Bedarf (Debug-Build); im Release deutlich leiser fuer Performance.
#if DEBUG
            SharedLibVlc = new LibVLC(enableDebugLogs: true, "--verbose=2");
#else
            SharedLibVlc = new LibVLC(enableDebugLogs: false);
#endif
            SharedLibVlc.Log += (_, ev) =>
            {
                if (ev.Level >= LibVLCSharp.Shared.LogLevel.Error)
                    _logger!.Error("libvlc", ev.Message);
            };
            _logger.Info("App", "LibVLC initialisiert.");
        }
        catch (Exception ex)
        {
            _logger.Critical("App", $"LibVLC-Initialisierung fehlgeschlagen: {ex}");
            MessageBox.Show(
                "Der Video-Player konnte nicht initialisiert werden.\n" +
                "Bitte pruefe, ob die VLC-Runtime-Bibliotheken vorhanden sind.\n\n" + ex.Message,
                "Kritischer Fehler", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        SharedLibVlc?.Dispose();
        _logger?.Info("App", "Sauber beendet.");
        base.OnExit(e);
    }
}

/// <summary>
/// Fängt unbeobachtete Task-Exceptions ab, damit Hintergrund-Fehler
/// (z. B. in Fire-and-forget-Downloads) nicht den Prozess killen.
/// </summary>
internal static class TaskSchedulerLogging
{
    public static void Register(FileLogger logger)
    {
        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            logger.Error("TaskScheduler", args.Exception.ToString());
            args.SetObserved();
        };
    }
}
