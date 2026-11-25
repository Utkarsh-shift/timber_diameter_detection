# Demo helper: signs in, analyses one photo and opens it in the Measurement Studio.
#   .\demo\analyze.ps1 -Image samples\synthetic_pile.jpg
#   .\demo\analyze.ps1 -Dataset val/image18.JPG -Profile timbervision-v1.0-seg    # real photo, scored against its ground truth
param(
  [string]$Image, [string]$Dataset, [string]$Sample,
  [string]$Profile = 'ellipse-v1.3-highrecall',
  [string]$Email = 'jkpapers@jkpaper.com', [string]$Password = 'jk123$',
  [string]$Api = 'http://localhost:4000', [string]$Web = 'http://localhost:5173'
)
$jar = Join-Path $env:TEMP 'pine-demo-cookies.txt'
$login = @{ email = $Email; password = $Password } | ConvertTo-Json -Compress
$login | & curl.exe -s -f -c $jar -H 'Content-Type: application/json' -d '@-' "$Api/api/auth/login" | Out-Null
if ($LASTEXITCODE) { Write-Error 'Sign-in failed (is the backend running, and are the credentials right?)'; exit 1 }

$form = @('-F', "profile=$Profile", '-F', 'scale_mode=ref_width', '-F', 'ref_width_mm=2400')
if ($Image)   { $form += @('-F', "image=@$Image") }
elseif ($Dataset) { $form += @('-F', "dataset=$Dataset") }
else { $form += @('-F', "sample=$(if ($Sample) { $Sample } else { 'synthetic_pile.jpg' })") }

Write-Host "Analysing with $Profile ..."
$r = & curl.exe -s -f -b $jar -X POST @form "$Api/api/analyze" | ConvertFrom-Json
if (-not $r.id) { Write-Error 'Analysis failed (is the analysis service up?)'; exit 1 }
"{0}: {1} logs, mean {2} mm, grade {3}, {4} ms" -f $r.id, $r.summary.count, $r.summary.mean_mm, $r.grade.grade, $r.timing.total_ms
if ($r.eval) { "vs ground truth: precision {0}%  recall {1}%  F1 {2}%" -f $r.eval.precision, $r.eval.recall, $r.eval.f1 }
Start-Process "$Web/studio?truck=$($r.id)"
