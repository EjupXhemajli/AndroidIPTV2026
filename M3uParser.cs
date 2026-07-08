<Window x:Class="ExIptvDesktop.Views.MainWindow"
        xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        xmlns:vlc="clr-namespace:LibVLCSharp.WPF;assembly=LibVLCSharp.WPF"
        Title="EX-IPTV Desktop" Height="800" Width="1280" MinHeight="600" MinWidth="960"
        WindowStartupLocation="CenterScreen">

    <Grid>
        <Grid.ColumnDefinitions>
            <ColumnDefinition Width="220" />
            <ColumnDefinition Width="280" />
            <ColumnDefinition Width="*" />
        </Grid.ColumnDefinitions>

        <!-- Kategorien -->
        <Grid Grid.Column="0" Background="{StaticResource SurfaceBrush}">
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
            </Grid.RowDefinitions>
            <TextBlock Text="Kategorien" Style="{StaticResource SectionHeaderStyle}" />
            <ListBox Grid.Row="1"
                     ItemsSource="{Binding Categories}"
                     SelectedItem="{Binding SelectedCategory, Mode=TwoWay}"
                     DisplayMemberPath="Name" />
        </Grid>

        <!-- Kanalliste -->
        <Grid Grid.Column="1" Background="#171A1F">
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto" />
                <RowDefinition Height="Auto" />
                <RowDefinition Height="*" />
            </Grid.RowDefinitions>

            <TextBlock Text="Sender" Style="{StaticResource SectionHeaderStyle}" />

            <Grid Grid.Row="1" Margin="8,0,8,8">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*" />
                    <ColumnDefinition Width="Auto" />
                </Grid.ColumnDefinitions>
                <TextBox Grid.Column="0" Text="{Binding SearchText, UpdateSourceTrigger=PropertyChanged}" />
                <Button Grid.Column="1" Content="Suchen" Style="{StaticResource IconButtonStyle}"
                        Command="{Binding SearchCommand}" Margin="6,0,0,0" />
            </Grid>

            <ListBox Grid.Row="2"
                     ItemsSource="{Binding Channels}"
                     SelectedItem="{Binding SelectedChannel, Mode=TwoWay}">
                <ListBox.ItemTemplate>
                    <DataTemplate>
                        <Grid MouseLeftButtonUp="ChannelItem_MouseLeftButtonUp">
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width="*" />
                                <ColumnDefinition Width="Auto" />
                            </Grid.ColumnDefinitions>
                            <TextBlock Grid.Column="0" Text="{Binding Name}" VerticalAlignment="Center"
                                       TextTrimming="CharacterEllipsis" />
                            <TextBlock Grid.Column="1" Text="★" Visibility="{Binding IsFavorite,
                                       Converter={StaticResource BoolToVisibilityConverter}}"
                                       Foreground="{StaticResource AccentMidBlueBrush}" Margin="6,0,0,0" />
                        </Grid>
                    </DataTemplate>
                </ListBox.ItemTemplate>
            </ListBox>
        </Grid>

        <!-- Player -->
        <Grid Grid.Column="2" Background="Black">
            <Grid.RowDefinitions>
                <RowDefinition Height="*" />
                <RowDefinition Height="Auto" />
            </Grid.RowDefinitions>

            <!-- Natives VideoView: LibVLCSharp.WPF rendert direkt per Direct3D,
                 kein Chromium-Prozess, kein HTML-Layer im Wiedergabepfad. -->
            <vlc:VideoView x:Name="VlcVideoView" Grid.Row="0" />

            <TextBlock Grid.Row="0" Text="{Binding Player.CurrentTitle}"
                       Foreground="White" FontSize="16" FontWeight="Bold"
                       Margin="16" VerticalAlignment="Top" HorizontalAlignment="Left"
                       Opacity="0.85" />

            <Border Grid.Row="1" Background="{StaticResource SurfaceBrush}" Padding="12,8">
                <Grid>
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="Auto" />
                        <ColumnDefinition Width="*" />
                        <ColumnDefinition Width="Auto" />
                    </Grid.ColumnDefinitions>

                    <StackPanel Orientation="Horizontal" Grid.Column="0">
                        <Button Content="⏯" Style="{StaticResource IconButtonStyle}"
                                Command="{Binding Player.TogglePauseCommand}" />
                        <Button Content="⏹" Style="{StaticResource IconButtonStyle}"
                                Command="{Binding Player.StopCommand}" />
                        <Button Content="⛶" Style="{StaticResource IconButtonStyle}"
                                Command="{Binding Player.ToggleFullscreenCommand}" />
                    </StackPanel>

                    <TextBlock Grid.Column="1" Text="{Binding Player.StatusText}"
                               VerticalAlignment="Center" HorizontalAlignment="Center"
                               Foreground="{StaticResource TextSecondaryBrush}" />

                    <TextBlock Grid.Column="2" Text="{Binding StatusMessage}"
                               VerticalAlignment="Center" Foreground="{StaticResource TextSecondaryBrush}" />
                </Grid>
            </Border>

            <ProgressBar Grid.Row="0" VerticalAlignment="Top" Height="3"
                         Value="{Binding ImportProgress}" Maximum="100"
                         Visibility="{Binding IsBusy, Converter={StaticResource BoolToVisibilityConverter}}" />
        </Grid>
    </Grid>
</Window>
