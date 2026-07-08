using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using ExIptvDesktop.Models;
using ExIptvDesktop.Services;

namespace ExIptvDesktop.ViewModels;

public partial class MainViewModel : ObservableObject
{
    private readonly DatabaseService _db;
    private readonly XtreamClient _xtream;
    private readonly FileLogger _logger;

    [ObservableProperty] private ObservableCollection<Category> categories = new();
    [ObservableProperty] private ObservableCollection<Channel> channels = new();
    [ObservableProperty] private Category? selectedCategory;
    [ObservableProperty] private Channel? selectedChannel;
    [ObservableProperty] private string searchText = string.Empty;
    [ObservableProperty] private string statusMessage = "Bereit.";
    [ObservableProperty] private bool isBusy;
    [ObservableProperty] private double importProgress;

    public PlayerViewModel Player { get; }

    private XtreamProfile? _activeProfile;

    public MainViewModel(DatabaseService db, XtreamClient xtream, FileLogger logger, PlayerViewModel player)
    {
        _db = db;
        _xtream = xtream;
        _logger = logger;
        Player = player;
    }

    public async Task InitializeAsync()
    {
        await _db.InitializeAsync();
        var profiles = await _db.GetProfilesAsync();
        _activeProfile = profiles.FirstOrDefault();

        if (_activeProfile != null)
            await LoadCategoriesAsync();
    }

    [RelayCommand]
    private async Task AddProfileAsync(XtreamProfile profile)
    {
        await _db.SaveProfileAsync(profile);
        _activeProfile = profile;
        await SyncPlaylistAsync();
    }

    [RelayCommand(CanExecute = nameof(CanSync))]
    private async Task SyncPlaylistAsync()
    {
        if (_activeProfile == null) return;

        IsBusy = true;
        StatusMessage = "Kontodaten werden geprueft...";
        try
        {
            var account = await _xtream.GetAccountInfoAsync(_activeProfile);
            if (account?.UserInfo?.Status != "Active")
            {
                StatusMessage = "Account ist nicht aktiv oder Zugangsdaten falsch.";
                _logger.Warning("MainViewModel", $"Xtream-Status: {account?.UserInfo?.Status}");
                return;
            }

            StatusMessage = "Kategorien werden geladen...";
            var liveCategories = await _xtream.GetLiveCategoriesAsync(_activeProfile);

            var categoryEntities = liveCategories.Select(c => new Category
            {
                ProfileId = _activeProfile.Id,
                ExternalCategoryId = c.CategoryId,
                Name = c.CategoryName,
                Type = ContentType.LiveTv
            }).ToList();

            StatusMessage = "Sender werden geladen...";
            var allChannels = new System.Collections.Generic.List<Channel>();

            for (int i = 0; i < liveCategories.Count; i++)
            {
                var cat = liveCategories[i];
                var streams = await _xtream.GetLiveStreamsAsync(_activeProfile, cat.CategoryId);

                allChannels.AddRange(streams.Select(s => new Channel
                {
                    ProfileId = _activeProfile.Id,
                    CategoryId = int.TryParse(s.CategoryId, out var cid) ? cid : 0,
                    ExternalStreamId = s.StreamId,
                    Name = s.Name,
                    LogoUrl = s.StreamIcon,
                    TvgId = s.EpgChannelId,
                    StreamUrl = _xtream.BuildLiveStreamUrl(_activeProfile, s.StreamId),
                    HasCatchUp = s.HasArchive,
                    CatchUpDays = s.ArchiveDays,
                    HasTimeshift = s.HasArchive,
                    Type = ContentType.LiveTv
                }));

                ImportProgress = (i + 1) / (double)Math.Max(1, liveCategories.Count) * 100;
            }

            await _db.ReplaceChannelsForProfileAsync(_activeProfile.Id, categoryEntities, allChannels);
            _activeProfile.LastSyncAt = DateTime.UtcNow;
            await _db.SaveProfileAsync(_activeProfile);

            await LoadCategoriesAsync();
            StatusMessage = $"Sync abgeschlossen: {categoryEntities.Count} Kategorien, {allChannels.Count} Sender.";
        }
        catch (Exception ex)
        {
            _logger.Error("MainViewModel", $"Sync fehlgeschlagen: {ex}");
            StatusMessage = "Sync fehlgeschlagen -- siehe Log fuer Details.";
        }
        finally
        {
            IsBusy = false;
            ImportProgress = 0;
        }
    }

    private bool CanSync() => _activeProfile != null && !IsBusy;

    private async Task LoadCategoriesAsync()
    {
        if (_activeProfile == null) return;
        var cats = await _db.GetCategoriesAsync(_activeProfile.Id, ContentType.LiveTv);
        Categories = new ObservableCollection<Category>(cats);
    }

    partial void OnSelectedCategoryChanged(Category? value)
    {
        if (value == null) return;
        _ = LoadChannelsForCategoryAsync(value.Id);
    }

    private async Task LoadChannelsForCategoryAsync(int categoryId)
    {
        var list = await _db.GetChannelsAsync(categoryId, includeAdult: !( _activeProfile?.AdultContentHidden ?? true));
        Channels = new ObservableCollection<Channel>(list);
    }

    [RelayCommand]
    private async Task SearchAsync()
    {
        if (_activeProfile == null || string.IsNullOrWhiteSpace(SearchText))
        {
            if (SelectedCategory != null) await LoadChannelsForCategoryAsync(SelectedCategory.Id);
            return;
        }

        var results = await _db.SearchChannelsAsync(_activeProfile.Id, SearchText);
        Channels = new ObservableCollection<Channel>(results);
    }

    [RelayCommand]
    private void PlayChannel(Channel? channel)
    {
        if (channel == null) return;
        SelectedChannel = channel;
        Player.PlayChannel(channel);
    }

    [RelayCommand]
    private async Task ToggleFavoriteAsync(Channel? channel)
    {
        if (channel == null) return;
        channel.IsFavorite = !channel.IsFavorite;
        await _db.ToggleFavoriteAsync(channel.Id, channel.IsFavorite);
    }
}
