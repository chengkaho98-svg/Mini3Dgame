$ErrorActionPreference = 'Stop'
$jobs = @(
    @{ src = 'C:\Users\upsde\OneDrive\Desktop\糖豆人\糖糖大亂鬥_AI開發Playbook.pptx'; out = 'C:\Users\upsde\OneDrive\Desktop\糖豆人\ppt-render-zh' },
    @{ src = 'C:\Users\upsde\OneDrive\Desktop\糖豆人\AI_Game_Development_Playbook_EN.pptx'; out = 'C:\Users\upsde\OneDrive\Desktop\糖豆人\ppt-render-en' }
)
$pp = New-Object -ComObject PowerPoint.Application
foreach ($j in $jobs) {
    $out = $j.out
    if (Test-Path $out) { Remove-Item "$out\*" -Force -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    $pres = $pp.Presentations.Open($j.src, $true, $false, $false)
    $pres.Export($out, 'PNG', 1600, 900)
    $pres.Close()
    Write-Output "EXPORTED: $out"
}
$pp.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($pp) | Out-Null
Write-Output 'RENDER_OK'
