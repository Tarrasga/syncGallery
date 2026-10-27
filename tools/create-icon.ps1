Add-Type -AssemblyName System.Drawing

$desktop = [Environment]::GetFolderPath('Desktop')
$syncGalleryDir = Join-Path $desktop "syncGallery"
$srcPath = "C:\Users\cac_7\.gemini\antigravity\brain\172af772-37bd-482f-8f54-be6e3e7ea721\icon_3d_1793064599430.jpg"
$icoPath = Join-Path $syncGalleryDir "app-icon.ico"
$pngPath = Join-Path $syncGalleryDir "app-icon.png"
$batPath = Join-Path $syncGalleryDir "Iniciar-syncGallery.bat"
$shortcutPath = Join-Path $desktop "syncGallery.lnk"

Write-Output "Carregando imagem original de: $srcPath"
$origBmp = [System.Drawing.Bitmap]::FromFile($srcPath)
$w = $origBmp.Width
$h = $origBmp.Height

# Create 32-bit ARGB bitmap
$transparentBmp = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

# Sample background color from corner
$c0 = $origBmp.GetPixel(10, 10)
$bgR = $c0.R
$bgG = $c0.G
$bgB = $c0.B

for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
        $p = $origBmp.GetPixel($x, $y)
        
        $dr = [double]($p.R - $bgR)
        $dg = [double]($p.G - $bgG)
        $db = [double]($p.B - $bgB)
        $dist = [Math]::Sqrt($dr * $dr + $dg * $dg + $db * $db)

        if ($dist -lt 20) {
            $transparentBmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
        } elseif ($dist -lt 60) {
            $alphaFactor = ($dist - 20.0) / (60.0 - 20.0)
            $alpha = [int]($alphaFactor * 255.0)
            $newR = [Math]::Min(255, [Math]::Max(0, [int]($p.R - $bgR * (1.0 - $alphaFactor))))
            $newG = [Math]::Min(255, [Math]::Max(0, [int]($p.G - $bgG * (1.0 - $alphaFactor))))
            $newB = [Math]::Min(255, [Math]::Max(0, [int]($p.B - $bgB * (1.0 - $alphaFactor))))
            $transparentBmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $newR, $newG, $newB))
        } else {
            $transparentBmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $p.R, $p.G, $p.B))
        }
    }
}

$origBmp.Dispose()

# Save PNG
$previewBmp = [System.Drawing.Bitmap]::new(256, 256)
$g = [System.Drawing.Graphics]::FromImage($previewBmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($transparentBmp, 0, 0, 256, 256)
$g.Dispose()

$previewBmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$previewBmp.Dispose()

Write-Output "PNG guardado em: $pngPath"

# Multi-resolution ICO sizes
$sizes = @(256, 128, 64, 48, 32, 16)
$pngBuffers = [System.Collections.Generic.List[byte[]]]::new()

foreach ($size in $sizes) {
    $resized = [System.Drawing.Bitmap]::new($size, $size)
    $gr = [System.Drawing.Graphics]::FromImage($resized)
    $gr.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gr.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $gr.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gr.DrawImage($transparentBmp, 0, 0, $size, $size)
    $gr.Dispose()

    $ms = [System.IO.MemoryStream]::new()
    $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $resized.Dispose()
    $pngBuffers.Add($ms.ToArray())
    $ms.Dispose()
}

$transparentBmp.Dispose()

# Build ICO
$fs = [System.IO.File]::Create($icoPath)
$bw = [System.IO.BinaryWriter]::new($fs)

$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$sizes.Count)

$offset = 6 + (16 * $sizes.Count)

for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $wByte = if ($s -ge 256) { [byte]0 } else { [byte]$s }
    $hByte = if ($s -ge 256) { [byte]0 } else { [byte]$s }

    $bw.Write($wByte)
    $bw.Write($hByte)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$pngBuffers[$i].Length)
    $bw.Write([uint32]$offset)

    $offset += $pngBuffers[$i].Length
}

for ($i = 0; $i -lt $sizes.Count; $i++) {
    $bw.Write($pngBuffers[$i])
}

$bw.Close()
$fs.Close()

Write-Output "ICO guardado em: $icoPath"

# Create Desktop Shortcut
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($shortcutPath)
$sc.TargetPath = $batPath
$sc.WorkingDirectory = $syncGalleryDir
$sc.IconLocation = "$icoPath,0"
$sc.Description = "syncGallery - Central de Fotos e Videos"
$sc.Save()

Write-Output "Atalho criado com sucesso no Ambiente de Trabalho: $shortcutPath"
