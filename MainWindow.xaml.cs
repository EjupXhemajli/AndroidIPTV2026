using SQLite;

namespace ExIptvDesktop.Models;

public enum PlaylistSourceType
{
    Unknown,
    M3U,
    M3U8,
    XtreamCodes,
    StalkerPortal,
    MacPortal,
    LocalFile
}

public enum ContentType
{
    LiveTv,
    Movie,
    Series,
    Radio,
    Unknown
}

public enum StreamContainer
{
    Ts,
    Hls,
    Mp4,
    Mkv,
    Unknown
}

[Table("Profiles")]
public class XtreamProfile
{
    [PrimaryKey, AutoIncrement] public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string BaseUrl { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public PlaylistSourceType SourceType { get; set; } = PlaylistSourceType.XtreamCodes;
    public string? LocalM3uPath { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastSyncAt { get; set; }
    public bool AdultContentHidden { get; set; } = true;
}

[Table("Categories")]
public class Category
{
    [PrimaryKey, AutoIncrement] public int Id { get; set; }
    [Indexed] public int ProfileId { get; set; }
    public string ExternalCategoryId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public ContentType Type { get; set; }
    public int SortOrder { get; set; }
    public bool IsAdult { get; set; }
}

[Table("Channels")]
public class Channel
{
    [PrimaryKey, AutoIncrement] public int Id { get; set; }
    [Indexed] public int ProfileId { get; set; }
    [Indexed] public int CategoryId { get; set; }

    public string ExternalStreamId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? LogoUrl { get; set; }
    public string StreamUrl { get; set; } = string.Empty;

    public string? TvgId { get; set; }
    public string? TvgName { get; set; }
    public string? Country { get; set; }
    public string? Language { get; set; }

    public ContentType Type { get; set; } = ContentType.LiveTv;
    public StreamContainer Container { get; set; } = StreamContainer.Ts;

    public bool HasCatchUp { get; set; }
    public int CatchUpDays { get; set; }
    public bool HasTimeshift { get; set; }

    public bool IsFavorite { get; set; }
    public DateTime? LastWatchedAt { get; set; }
    public long ResumePositionMs { get; set; }
}

[Table("Series")]
public class SeriesItem
{
    [PrimaryKey, AutoIncrement] public int Id { get; set; }
    [Indexed] public int ProfileId { get; set; }
    [Indexed] public int CategoryId { get; set; }

    public string ExternalSeriesId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? CoverUrl { get; set; }
    public string? Plot { get; set; }
    public string? Genre { get; set; }
    public string? Cast { get; set; }
    public double? Rating { get; set; }
    public int? ReleaseYear { get; set; }
}

[Table("Episodes")]
public class Episode
{
    [PrimaryKey, AutoIncrement] public int Id { get; set; }
    [Indexed] public int SeriesId { get; set; }
    public string ExternalEpisodeId { get; set; } = string.Empty;
    public int Season { get; set; }
    public int EpisodeNumber { get; set; }
    public string Title { get; set; } = string.Empty;
    public string StreamUrl { get; set; } = string.Empty;
    public StreamContainer Container { get; set; } = StreamContainer.Mp4;
    public int? DurationSeconds { get; set; }
    public long ResumePositionMs { get; set; }
    public DateTime? LastWatchedAt { get; set; }
}

[Table("Movies")]
public class MovieItem
{
    [PrimaryKey, AutoIncrement] public int Id { get; set; }
    [Indexed] public int ProfileId { get; set; }
    [Indexed] public int CategoryId { get; set; }

    public string ExternalStreamId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? CoverUrl { get; set; }
    public string? Plot { get; set; }
    public string? Genre { get; set; }
    public double? Rating { get; set; }
    public int? ReleaseYear { get; set; }
    public string StreamUrl { get; set; } = string.Empty;
    public StreamContainer Container { get; set; } = StreamContainer.Mp4;
    public long ResumePositionMs { get; set; }
    public DateTime? LastWatchedAt { get; set; }

    // Duplikat-Erkennung: normalisierter Titel + Jahr als Fingerabdruck
    public string DedupeKey => $"{Title.Trim().ToLowerInvariant()}|{ReleaseYear}";
}
