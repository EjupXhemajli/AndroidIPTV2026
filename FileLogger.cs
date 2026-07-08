<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">

    <Style TargetType="{x:Type Window}">
        <Setter Property="Background" Value="{StaticResource BackgroundBrush}" />
        <Setter Property="Foreground" Value="{StaticResource TextPrimaryBrush}" />
        <Setter Property="FontFamily" Value="Calibri" />
    </Style>

    <Style TargetType="{x:Type TextBlock}">
        <Setter Property="Foreground" Value="{StaticResource TextPrimaryBrush}" />
        <Setter Property="FontFamily" Value="Calibri" />
    </Style>

    <Style x:Key="SectionHeaderStyle" TargetType="TextBlock">
        <Setter Property="Foreground" Value="{StaticResource AccentMidBlueBrush}" />
        <Setter Property="FontWeight" Value="Bold" />
        <Setter Property="FontSize" Value="14" />
        <Setter Property="Margin" Value="8,8,8,4" />
    </Style>

    <Style TargetType="{x:Type ListBoxItem}">
        <Setter Property="Padding" Value="8,6" />
        <Setter Property="Foreground" Value="{StaticResource TextPrimaryBrush}" />
        <Style.Triggers>
            <Trigger Property="IsSelected" Value="True">
                <Setter Property="Background" Value="{StaticResource AccentDarkBlueBrush}" />
            </Trigger>
            <Trigger Property="IsMouseOver" Value="True">
                <Setter Property="Background" Value="#26303D" />
            </Trigger>
        </Style.Triggers>
    </Style>

    <Style TargetType="{x:Type ListBox}">
        <Setter Property="Background" Value="{StaticResource SurfaceBrush}" />
        <Setter Property="BorderThickness" Value="0" />
    </Style>

    <Style x:Key="IconButtonStyle" TargetType="Button">
        <Setter Property="Background" Value="Transparent" />
        <Setter Property="BorderThickness" Value="0" />
        <Setter Property="Foreground" Value="{StaticResource TextPrimaryBrush}" />
        <Setter Property="Padding" Value="10,6" />
        <Setter Property="Cursor" Value="Hand" />
        <Style.Triggers>
            <Trigger Property="IsMouseOver" Value="True">
                <Setter Property="Background" Value="{StaticResource AccentMidBlueBrush}" />
            </Trigger>
        </Style.Triggers>
    </Style>

    <Style TargetType="{x:Type TextBox}">
        <Setter Property="Background" Value="{StaticResource SurfaceBrush}" />
        <Setter Property="Foreground" Value="{StaticResource TextPrimaryBrush}" />
        <Setter Property="BorderBrush" Value="{StaticResource AccentMidBlueBrush}" />
        <Setter Property="Padding" Value="6,4" />
    </Style>

</ResourceDictionary>
