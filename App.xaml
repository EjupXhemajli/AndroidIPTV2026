using System;
using System.IO;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using ExIptvDesktop.Models;
using ExIptvDesktop.Services;
using ExIptvDesktop.ViewModels;

namespace ExIptvDesktop.Views;

public partial class MainWindow : Window
{
    private DatabaseService? _db;
    private VlcPlayerService? _playerService;
    private MainViewModel? _viewModel;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += MainWindow_Loaded;
        Closing += MainWindow_Closing;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        var logger = new FileLogger(Path.Combine(App.AppDataRoot, "logs"));

        _db = new DatabaseService(Path.Combine(App.AppDataRoot, "exiptv.db3"), logger);

        var httpClient = new HttpClient();
        var xtreamClient = new XtreamClient(httpClient, logger);

        _playerService = new VlcPlayerService(App.SharedLibVlc!, logger);
        var playerViewModel = new PlayerViewModel(_playerService, _db);

        _viewModel = new MainViewModel(_db, xtreamClient, logger, playerViewModel);
        DataContext = _viewModel;

        playerViewModel.InitializePlayer();
        VlcVideoView.MediaPlayer = playerViewModel.MediaPlayer;

        try
        {
            await _viewModel.InitializeAsync();
        }
        catch (Exception ex)
        {
            logger.Critical("MainWindow", $"Initialisierung fehlgeschlagen: {ex}");
            MessageBox.Show(this,
                "Die Anwendung konnte nicht vollständig initialisiert werden. Details im Log.",
                "Fehler", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void ChannelItem_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: Channel channel } && _viewModel != null)
            _viewModel.PlayChannelCommand.Execute(channel);
    }

    private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        _viewModel?.Player.SaveResumePosition();
        _viewModel?.Player.Dispose();
        _db?.Dispose();
    }
}
