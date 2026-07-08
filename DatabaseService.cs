<Application x:Class="ExIptvDesktop.App"
             xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
             xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
             xmlns:conv="clr-namespace:ExIptvDesktop.Views.Converters"
             StartupUri="Views/MainWindow.xaml">
    <Application.Resources>
        <ResourceDictionary>
            <ResourceDictionary.MergedDictionaries>
                <ResourceDictionary Source="Views/Styles/Colors.xaml" />
                <ResourceDictionary Source="Views/Styles/Controls.xaml" />
            </ResourceDictionary.MergedDictionaries>
            <conv:BoolToVisibilityConverter x:Key="BoolToVisibilityConverter" />
        </ResourceDictionary>
    </Application.Resources>
</Application>
