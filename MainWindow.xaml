using System;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using ExIptvDesktop.Models;
using ExIptvDesktop.Services;
using LibVLCSharp.Shared;

namespace ExIptvDesktop.ViewModels;

public partial class PlayerViewModel : ObservableObject, IDisposable
{
    private readonly VlcPlayerService _playerService;
    private readonly DatabaseService _db;
    private Channel? _currentChannel;

    [ObservableProperty] private PlaybackState state = PlaybackState.Idle;
    [ObservableProperty] private string statusText = string.Empty;
    [ObservableProperty] private string? currentTitle;
    [ObservableProperty] private bool isFullscreen;

    public MediaPlayer? MediaPlayer => _playerService.Player;

    public PlayerViewModel(VlcPlayerService playerService, DatabaseService db)
    {
        _playerService = playerService;
        _db = db;
        _playerService.StateChanged += (_, e) =>
        {
            State = e.State;
            StatusText = e.Message ?? DescribeState(e.State);
        };
    }

    public void InitializePlayer() => _playerService.CreatePlayer();

    public void PlayChannel(Channel channel)
    {
        _currentChannel = channel;
        CurrentTitle = channel.Name;
        _playerService.Open(channel.StreamUrl, isLive: channel.Type == ContentType.LiveTv);
    }

    [RelayCommand]
    private void TogglePause()
    {
        if (State == PlaybackState.Playing) _playerService.Pause();
        else _playerService.Resume();
    }

    [RelayCommand]
    private void Stop() => _playerService.Stop();

    [RelayCommand]
    private void ToggleFullscreen() => IsFullscreen = !IsFullscreen;

    public async void SaveResumePosition()
    {
        if (_currentChannel == null || MediaPlayer == null) return;
        await _db.UpdateResumePositionAsync(_currentChannel.Id, MediaPlayer.Time);
    }

    private static string DescribeState(PlaybackState s) => s switch
    {
        PlaybackState.Opening => "Stream wird geoeffnet...",
        PlaybackState.Buffering => "Puffert...",
        PlaybackState.Playing => "Wiedergabe laeuft",
        PlaybackState.Paused => "Pausiert",
        PlaybackState.Reconnecting => "Verbindung wird wiederhergestellt...",
        PlaybackState.Error => "Fehler bei der Wiedergabe",
        _ => ""
    };

    public void Dispose() => _playerService.Dispose();
}
