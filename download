using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using ExIptvDesktop.Models;
using Polly;
using Polly.Retry;

namespace ExIptvDesktop.Services;

public sealed class XtreamAccountInfo
{
    [JsonPropertyName("user_info")] public UserInfoDto? UserInfo { get; set; }
    [JsonPropertyName("server_info")] public ServerInfoDto? ServerInfo { get; set; }

    public sealed class UserInfoDto
    {
        [JsonPropertyName("status")] public string? Status { get; set; }
        [JsonPropertyName("exp_date")] public string? ExpDate { get; set; }
        [JsonPropertyName("max_connections")] public string? MaxConnections { get; set; }
        [JsonPropertyName("active_cons")] public string? ActiveConnections { get; set; }
    }

    public sealed class ServerInfoDto
    {
        [JsonPropertyName("url")] public string? Url { get; set; }
        [JsonPropertyName("port")] public string? Port { get; set; }
        [JsonPropertyName("https_port")] public string? HttpsPort { get; set; }
    }
}

public sealed class XtreamCategoryDto
{
    [JsonPropertyName("category_id")] public string CategoryId { get; set; } = "";
    [JsonPropertyName("category_name")] public string CategoryName { get; set; } = "";
}

public sealed class XtreamLiveStreamDto
{
    [JsonPropertyName("stream_id")] public JsonElement StreamIdRaw { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("stream_icon")] public string? StreamIcon { get; set; }
    [JsonPropertyName("category_id")] public JsonElement CategoryIdRaw { get; set; }
    [JsonPropertyName("epg_channel_id")] public string? EpgChannelId { get; set; }
    [JsonPropertyName("tv_archive")] public JsonElement TvArchiveRaw { get; set; }
    [JsonPropertyName("tv_archive_duration")] public JsonElement TvArchiveDurationRaw { get; set; }

    // Root-Cause vieler Parser-Abstuerze bei Xtream-Providern: category_id/stream_id
    // kommen je nach Panel-Software mal als int, mal als string im JSON.
    // Deshalb ueber JsonElement einlesen und flexibel konvertieren statt starrer Typen.
    public string StreamId => FlexibleToString(StreamIdRaw);
    public string CategoryId => FlexibleToString(CategoryIdRaw);
    public bool HasArchive => FlexibleToString(TvArchiveRaw) == "1";
    public int ArchiveDays => int.TryParse(FlexibleToString(TvArchiveDurationRaw), out var d) ? d : 0;

    private static string FlexibleToString(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.String => el.GetString() ?? "",
        JsonValueKind.Number => el.GetRawText(),
        _ => ""
    };
}

/// <summary>
/// Client fuer die Xtream-Codes player_api.php. Nutzt einen wiederverwendeten
/// HttpClient (kein Socket-Exhaustion durch "new HttpClient()" pro Request) mit
/// Polly-Retry (exponentielles Backoff) fuer voruebergehende Netzwerkfehler.
/// </summary>
public sealed class XtreamClient
{
    private readonly HttpClient _http;
    private readonly FileLogger _logger;
    private readonly AsyncRetryPolicy<HttpResponseMessage> _retryPolicy;

    public XtreamClient(HttpClient http, FileLogger logger)
    {
        _http = http;
        _http.Timeout = TimeSpan.FromSeconds(20);
        _logger = logger;

        _retryPolicy = Policy
            .HandleResult<HttpResponseMessage>(r => !r.IsSuccessStatusCode)
            .Or<HttpRequestException>()
            .Or<TaskCanceledException>()
            .WaitAndRetryAsync(
                retryCount: 3,
                sleepDurationProvider: attempt => TimeSpan.FromMilliseconds(300 * Math.Pow(2, attempt)),
                onRetry: (outcome, delay, attempt, _) =>
                    _logger.Warning("XtreamClient",
                        $"Retry {attempt} nach {delay.TotalMilliseconds}ms " +
                        $"({outcome.Exception?.Message ?? outcome.Result?.StatusCode.ToString()})"));
    }

    private static string BuildBaseQuery(XtreamProfile p) =>
        $"{p.BaseUrl.TrimEnd('/')}/player_api.php?username={Uri.EscapeDataString(p.Username)}" +
        $"&password={Uri.EscapeDataString(p.Password)}";

    public async Task<XtreamAccountInfo?> GetAccountInfoAsync(XtreamProfile profile, CancellationToken ct = default)
    {
        var json = await GetJsonAsync(BuildBaseQuery(profile), ct);
        return json == null ? null : JsonSerializer.Deserialize<XtreamAccountInfo>(json);
    }

    public async Task<List<XtreamCategoryDto>> GetLiveCategoriesAsync(XtreamProfile p, CancellationToken ct = default)
        => await GetListAsync<XtreamCategoryDto>($"{BuildBaseQuery(p)}&action=get_live_categories", ct);

    public async Task<List<XtreamCategoryDto>> GetVodCategoriesAsync(XtreamProfile p, CancellationToken ct = default)
        => await GetListAsync<XtreamCategoryDto>($"{BuildBaseQuery(p)}&action=get_vod_categories", ct);

    public async Task<List<XtreamCategoryDto>> GetSeriesCategoriesAsync(XtreamProfile p, CancellationToken ct = default)
        => await GetListAsync<XtreamCategoryDto>($"{BuildBaseQuery(p)}&action=get_series_categories", ct);

    public async Task<List<XtreamLiveStreamDto>> GetLiveStreamsAsync(
        XtreamProfile p, string? categoryId = null, CancellationToken ct = default)
    {
        var url = $"{BuildBaseQuery(p)}&action=get_live_streams";
        if (!string.IsNullOrEmpty(categoryId)) url += $"&category_id={Uri.EscapeDataString(categoryId)}";
        return await GetListAsync<XtreamLiveStreamDto>(url, ct);
    }

    public string BuildLiveStreamUrl(XtreamProfile p, string streamId, string ext = "ts") =>
        $"{p.BaseUrl.TrimEnd('/')}/live/{Uri.EscapeDataString(p.Username)}/" +
        $"{Uri.EscapeDataString(p.Password)}/{streamId}.{ext}";

    public string BuildCatchUpUrl(XtreamProfile p, string streamId, DateTime startUtc, int durationMinutes) =>
        $"{p.BaseUrl.TrimEnd('/')}/timeshift/{Uri.EscapeDataString(p.Username)}/" +
        $"{Uri.EscapeDataString(p.Password)}/{durationMinutes}/" +
        $"{startUtc:yyyy-MM-dd:HH-mm}/{streamId}.ts";

    private async Task<List<T>> GetListAsync<T>(string url, CancellationToken ct)
    {
        var json = await GetJsonAsync(url, ct);
        if (json == null) return new List<T>();

        try
        {
            return JsonSerializer.Deserialize<List<T>>(json) ?? new List<T>();
        }
        catch (JsonException ex)
        {
            _logger.Error("XtreamClient", $"JSON-Parsing fehlgeschlagen fuer {url}: {ex.Message}");
            return new List<T>();
        }
    }

    private async Task<string?> GetJsonAsync(string url, CancellationToken ct)
    {
        try
        {
            var response = await _retryPolicy.ExecuteAsync(() => _http.GetAsync(url, ct));
            if (!response.IsSuccessStatusCode)
            {
                _logger.Error("XtreamClient", $"HTTP {(int)response.StatusCode} fuer {url}");
                return null;
            }
            return await response.Content.ReadAsStringAsync(ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            _logger.Error("XtreamClient", $"Netzwerkfehler nach Retries: {ex.Message}");
            return null;
        }
    }
}
