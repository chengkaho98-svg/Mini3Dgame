$ErrorActionPreference = 'Stop'
$src = 'C:\Users\upsde\OneDrive\Desktop\糖豆人\糖糖大亂鬥_AI開發Playbook.pptx'
$out = 'C:\Users\upsde\OneDrive\Desktop\糖豆人\ppt-render'
if (Test-Path $out) { Remove-Item "$out\*" -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $out | Out-Null
$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Open($src, $true, $false, $false)
$pres.Export($out, 'PNG', 1600, 900)
$pres.Close()
$pp.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($pp) | Out-Null
Write-Output 'RENDER_OK'
Get-ChildItem $out | Select-Object -ExpandProperty Name
