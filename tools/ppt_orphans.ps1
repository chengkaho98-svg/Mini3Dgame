# Reports how PowerPoint actually breaks every paragraph of the decks in this
# folder: one line per paragraph, tab separated —
#   deck, slide, paragraph, lineCount, paragraphLength, textOfLastLine
# Used to find "orphans" (a last line holding a single character or word).
# Read the report with:  node tools/ppt-orphans.js
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outFile = Join-Path $root 'ppt-orphans.txt'
$withWindow = $true            # PowerPoint only lays text out when the deck has a window
$pp = New-Object -ComObject PowerPoint.Application
$rows = New-Object System.Collections.Generic.List[string]
foreach ($f in Get-ChildItem -Path $root -Filter *.pptx) {
    $pres = $pp.Presentations.Open($f.FullName, $true, $false, $withWindow)
    foreach ($slide in $pres.Slides) {
        foreach ($shape in $slide.Shapes) {
            if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
                $tr = $shape.TextFrame.TextRange
                $np = $tr.Paragraphs().Count
                for ($p = 1; $p -le $np; $p++) {
                    $para = $tr.Paragraphs($p, 1)
                    $nl = $para.Lines().Count
                    $last = $para.Lines($nl, 1).Text
                    $first = $para.Lines(1, 1).Text
                    $full = $para.Text -replace "[\v\n\r\t]", ' '
                    $rows.Add(("{0}`t{1}`t{2}`t{3}`t{4}`t{5}`t{6}`t{7}" -f $f.Name, $slide.SlideIndex, $p, $nl, $para.Text.Length, $last, $first, $full))
                }
            }
        }
    }
    $pres.Close()
}
$pp.Quit()
[System.IO.File]::WriteAllLines($outFile, $rows, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("ORPHAN_SCAN_OK {0} paragraphs -> ppt-orphans.txt" -f $rows.Count)
