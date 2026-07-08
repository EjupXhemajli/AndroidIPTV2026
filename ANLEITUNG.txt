using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using ExIptvDesktop.Models;

namespace ExIptvDesktop.Services;

public sealed record ParsedEntry(
    string Name,
    string Url,
    string? TvgId,
    string? TvgName,
    string? TvgLogo,
    string? GroupTitle,
    string? Language,
    string? Country,
    ContentType Type,
    int? SeasonNumber,
    int? EpisodeNumber,
    int? Year);

/// <summary>
/// Streaming-M3U-Parser: liest Zeile fuer Zeile statt die komplette Datei in den
/// Speicher zu laden. Wichtig fuer Playlisten mit 100.000+ Eintraegen, um
/// OutOfMemory und UI-Freezes beim Import zu vermeiden.
/// </summary>
public static class M3uParser
{
    private static readonly Regex AttrRegex = new(
        "(?<key>[a-zA-Z0-9_-]+)=\"(?<value>[^\"]*)\"", RegexOptions.Compiled);

    // Serien-Erkennung: "Show Name S01E02" oder "Show Name 1x02"
    private static readonly Regex SeasonEpisodeRegex = new(
        @"[Ss](?<season>\d{1,2})\s*[Ee](?<episode>\d{1,3})|(?<season2>\d{1,2})x(?<episode2>\d{1,3})",
        RegexOptions.Compiled);

    private static readonly Regex YearRegex = new(@"\((?<year>(19|20)\d{2})\)", RegexOptions.Compiled);

    public static IEnumerable<ParsedEntry> ParseStream(Stream stream, Encoding encoding)
    {
        using var reader = new StreamReader(stream, encoding, detectEncodingFromByteOrderMarks: true);

        string? extInfLine = null;
        string? line;

        while ((line = reader.ReadLine()) != null)
        {
            if (line.Length == 0) continue;

            if (line.StartsWith("#EXTINF", StringComparison.OrdinalIgnoreCase))
            {
                extInfLine = line;
                continue;
            }

            if (line.StartsWith("#")) continue; // andere Tags (#EXTM3U, #EXTGRP, ...) ignorieren

            if (extInfLine == null) continue; // URL ohne vorangehendes EXTINF -> ueberspringen, defektes Format

            var entry = ParseEntry(extInfLine, line.Trim());
            if (entry != null)
                yield return entry;

            extInfLine = null;
        }
    }

    private static ParsedEntry? ParseEntry(string extInfLine, string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;

        // Format: #EXTINF:-1 tvg-id="..." tvg-name="..." group-title="...",Anzeigename
        var commaIndex = extInfLine.LastIndexOf(',');
        if (commaIndex < 0) return null;

        var attrPart = extInfLine.Substring(0, commaIndex);
        var name = extInfLine.Substring(commaIndex + 1).Trim();
        if (string.IsNullOrWhiteSpace(name)) name = "Unbenannt";

        string? tvgId = null, tvgName = null, tvgLogo = null, groupTitle = null,
            language = null, country = null;

        foreach (Match m in AttrRegex.Matches(attrPart))
        {
            var key = m.Groups["key"].Value.ToLowerInvariant();
            var value = m.Groups["value"].Value;
            switch (key)
            {
                case "tvg-id": tvgId = value; break;
                case "tvg-name": tvgName = value; break;
                case "tvg-logo": tvgLogo = value; break;
                case "group-title": groupTitle = value; break;
                case "tvg-language": language = value; break;
                case "tvg-country": country = value; break;
            }
        }

        var type = ClassifyContentType(groupTitle, name, url);

        int? season = null, episode = null, year = null;

        if (type == ContentType.Series)
        {
            var seMatch = SeasonEpisodeRegex.Match(name);
            if (seMatch.Success)
            {
                season = int.Parse(seMatch.Groups["season"].Success
                    ? seMatch.Groups["season"].Value : seMatch.Groups["season2"].Value);
                episode = int.Parse(seMatch.Groups["episode"].Success
                    ? seMatch.Groups["episode"].Value : seMatch.Groups["episode2"].Value);
            }
        }

        if (type == ContentType.Movie)
        {
            var yearMatch = YearRegex.Match(name);
            if (yearMatch.Success)
                year = int.Parse(yearMatch.Groups["year"].Value);
        }

        return new ParsedEntry(name, url, tvgId, tvgName, tvgLogo, groupTitle,
            language, country, type, season, episode, year);
    }

    /// <summary>
    /// Kategorisierung nach group-title/Keywords, wenn kein explizites Serien-/Film-Flag
    /// aus einer Xtream-API vorliegt (reine M3U-Quellen haben das oft nicht).
    /// </summary>
    private static ContentType ClassifyContentType(string? groupTitle, string name, string url)
    {
        var haystack = $"{groupTitle} {name}".ToLowerInvariant();

        if (SeasonEpisodeRegex.IsMatch(name))
            return ContentType.Series;

        if (haystack.Contains("series") || haystack.Contains("serien") || haystack.Contains("dizi"))
            return ContentType.Series;

        if (haystack.Contains("vod") || haystack.Contains("movie") || haystack.Contains("filme")
            || haystack.Contains("film "))
            return ContentType.Movie;

        if (haystack.Contains("radio"))
            return ContentType.Radio;

        return ContentType.LiveTv;
    }
}
