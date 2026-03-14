<#
.SYNOPSIS
  Export PPTX slides as high-resolution PNG images using PowerPoint COM Automation.

.DESCRIPTION
  Uses the actual PowerPoint rendering engine (COM) to export slides at 300 DPI (4000x2250px).
  This produces pixel-identical output to what you see in PowerPoint.

.PARAMETER PptxPath
  Path to the .pptx file to export.

.PARAMETER OutputDir
  Directory to save PNG files. Created if it doesn't exist.

.PARAMETER Width
  Export width in pixels. Default: 4000 (300 DPI for 16:9).

.PARAMETER Height
  Export height in pixels. Default: 2250 (300 DPI for 16:9).

.PARAMETER Slides
  Comma-separated slide numbers to export. Default: all slides.

.EXAMPLE
  .\export-slides-png.ps1 -PptxPath "slides\pres\output.pptx" -OutputDir "slides\pres\preview"
  .\export-slides-png.ps1 -PptxPath "output.pptx" -OutputDir "preview" -Slides "1,3,5"
  .\export-slides-png.ps1 -PptxPath "output.pptx" -OutputDir "preview" -Width 2000 -Height 1125
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$PptxPath,

    [Parameter(Mandatory=$true)]
    [string]$OutputDir,

    [int]$Width = 4000,
    [int]$Height = 2250,

    [string]$Slides = ""
)

# Resolve to absolute paths
$PptxPath = (Resolve-Path $PptxPath).Path
if (-not (Test-Path $PptxPath)) {
    Write-Error "File not found: $PptxPath"
    exit 1
}

# Create output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}
$OutputDir = (Resolve-Path $OutputDir).Path

# Parse slide numbers if specified
$slideFilter = @()
if ($Slides -ne "") {
    $slideFilter = $Slides -split "," | ForEach-Object { [int]$_.Trim() }
}

$ppt = $null
$presentation = $null

try {
    # Start PowerPoint COM
    $ppt = New-Object -ComObject PowerPoint.Application
    $ppt.Visible = [Microsoft.Office.Core.MsoTriState]::msoTrue

    # Open presentation read-only
    $presentation = $ppt.Presentations.Open($PptxPath, $true, $false, $false)
    $totalSlides = $presentation.Slides.Count

    Write-Host "Exporting $PptxPath ($totalSlides slides) at ${Width}x${Height}px..."

    $exported = 0
    for ($i = 1; $i -le $totalSlides; $i++) {
        # Skip if not in filter
        if ($slideFilter.Count -gt 0 -and $slideFilter -notcontains $i) {
            continue
        }

        $outPath = Join-Path $OutputDir ("slide_{0:D2}.png" -f $i)
        $presentation.Slides.Item($i).Export($outPath, "PNG", $Width, $Height)
        $exported++
        Write-Host "  slide $i -> $outPath"
    }

    Write-Host "`nExported $exported slide(s) to $OutputDir"

} catch {
    Write-Error "Export failed: $_"
    exit 1

} finally {
    if ($presentation) {
        $presentation.Close()
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($presentation) | Out-Null
    }
    if ($ppt) {
        $ppt.Quit()
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($ppt) | Out-Null
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
