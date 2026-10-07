Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase

function Generate-GradIcon([int]$size, [string]$path) {
    $dv = New-Object System.Windows.Media.DrawingVisual
    $dc = $dv.RenderOpen()

    # 1. Dark squircle background (#1C1E1F)
    $bgBrush = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(255, 28, 30, 31))
    $borderBrush = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(38, 255, 255, 255))
    $borderW = [Math]::Max(1.0, $size * 0.03)
    $borderPen = New-Object System.Windows.Media.Pen($borderBrush, $borderW)

    $radius = [double]($size * 0.22)
    $pad = if ($size -le 16) { 0.5 } else { [Math]::Max(0.5, $size * 0.02) }
    $w = [double]($size - 2.0 * $pad)
    $rect = New-Object System.Windows.Rect([double]$pad, [double]$pad, $w, $w)
    $dc.DrawRoundedRectangle($bgBrush, $borderPen, $rect, $radius, $radius)

    # 2. Vector graduation-cap (Lucide)
    $scaleRatio = if ($size -le 16) { 0.82 } elseif ($size -le 32) { 0.74 } else { 0.68 }
    $scale = ($size * $scaleRatio) / 24.0
    $offsetX = ($size - 24.0 * $scale) / 2.0
    $offsetY = ($size - 24.0 * $scale) / 2.0

    $strokeW = if ($size -le 16) { 1.5 } elseif ($size -le 32) { 1.7 } else { 1.8 }
    $whiteBrush = [System.Windows.Media.Brushes]::White
    $whitePen = New-Object System.Windows.Media.Pen($whiteBrush, [double]$strokeW)
    $whitePen.StartLineCap = [System.Windows.Media.PenLineCap]::Round
    $whitePen.EndLineCap = [System.Windows.Media.PenLineCap]::Round
    $whitePen.LineJoin = [System.Windows.Media.PenLineJoin]::Round

    $tg = New-Object System.Windows.Media.TransformGroup
    $tg.Children.Add((New-Object System.Windows.Media.ScaleTransform($scale, $scale)))
    $tg.Children.Add((New-Object System.Windows.Media.TranslateTransform($offsetX, $offsetY)))
    $dc.PushTransform($tg)

    # Path 1: Cap Diamond
    $g1 = [System.Windows.Media.Geometry]::Parse("M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z")
    $dc.DrawGeometry($null, $whitePen, $g1)

    # Path 2: Tassel
    $g2 = [System.Windows.Media.Geometry]::Parse("M22 10v6")
    $dc.DrawGeometry($null, $whitePen, $g2)

    # Path 3: Skull base
    $g3 = [System.Windows.Media.Geometry]::Parse("M6 12.5V16a6 3 0 0 0 12 0v-3.5")
    $dc.DrawGeometry($null, $whitePen, $g3)

    $dc.Pop()
    $dc.Close()

    $rtb = New-Object System.Windows.Media.Imaging.RenderTargetBitmap($size, $size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
    $rtb.Render($dv)

    $enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($rtb))

    $fs = [System.IO.File]::Create($path)
    $enc.Save($fs)
    $fs.Close()
    Write-Host "Generated $path ($size x $size)"
}

$destDir = "e:\AI\picinpic\extension\icons"
if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir | Out-Null }

@(16, 32, 48, 128) | ForEach-Object {
    Generate-GradIcon $_ "$destDir\icon$_.png"
}
