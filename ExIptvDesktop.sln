using System;
using System.IO;
using System.Text;

namespace ExIptvDesktop.Services;

public enum LogSeverity { Debug, Info, Warning, Error, Critical }

/// <summary>
/// Leichtgewichtiges, thread-sicheres Datei-Logging ohne externe Abhängigkeiten.
/// Rotiert taeglich, haelt einen In-Memory-Puffer fuer die zuletzt geloggten
/// Fehler (fuer eine "Diagnose"-Ansicht in der UI).
/// </summary>
public sealed class FileLogger
{
    private readonly string _logDir;
    private readonly object _writeLock = new();
    private readonly RingBuffer<string> _recentErrors = new(200);

    public FileLogger(string logDir)
    {
        _logDir = logDir;
        Directory.CreateDirectory(_logDir);
    }

    private string CurrentFile => Path.Combine(_logDir, $"exiptv_{DateTime.Now:yyyy-MM-dd}.log");

    public void Debug(string source, string message) => Write(LogSeverity.Debug, source, message);
    public void Info(string source, string message) => Write(LogSeverity.Info, source, message);
    public void Warning(string source, string message) => Write(LogSeverity.Warning, source, message);
    public void Error(string source, string message) => Write(LogSeverity.Error, source, message);
    public void Critical(string source, string message) => Write(LogSeverity.Critical, source, message);

    public string[] RecentErrors() => _recentErrors.Snapshot();

    private void Write(LogSeverity severity, string source, string message)
    {
        var line = $"{DateTime.Now:HH:mm:ss.fff} [{severity,-8}] {source}: {message}";

        lock (_writeLock)
        {
            try
            {
                File.AppendAllText(CurrentFile, line + Environment.NewLine, Encoding.UTF8);
            }
            catch
            {
                // Logging darf niemals selbst die App zum Absturz bringen.
            }
        }

        if (severity >= LogSeverity.Error)
            _recentErrors.Add(line);

#if DEBUG
        System.Diagnostics.Debug.WriteLine(line);
#endif
    }

    private sealed class RingBuffer<T>
    {
        private readonly T[] _items;
        private int _index;
        private int _count;
        private readonly object _lock = new();

        public RingBuffer(int capacity) => _items = new T[capacity];

        public void Add(T item)
        {
            lock (_lock)
            {
                _items[_index] = item;
                _index = (_index + 1) % _items.Length;
                if (_count < _items.Length) _count++;
            }
        }

        public T[] Snapshot()
        {
            lock (_lock)
            {
                var result = new T[_count];
                for (int i = 0; i < _count; i++)
                    result[i] = _items[(_index - _count + i + _items.Length) % _items.Length];
                return result;
            }
        }
    }
}
