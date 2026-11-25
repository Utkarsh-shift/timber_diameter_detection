$ErrorActionPreference = 'Stop'

$root = Join-Path $PSScriptRoot 'data\timbervision'
$archive = Join-Path $root 'timbervision.zip'
New-Item -ItemType Directory -Force -Path $root | Out-Null

if (-not (Test-Path $archive) -or (Get-Item $archive).Length -ne 4295374572) {
    curl.exe -L --ssl-no-revoke --fail --retry 3 --continue-at - `
        --output $archive `
        'https://zenodo.org/records/14825846/files/timbervision.zip?download=1'
    if ($LASTEXITCODE -ne 0) {
        throw "TimberVision download failed with curl exit code $LASTEXITCODE"
    }
}

$python = (Get-Command python -ErrorAction Stop).Source
& $python (Join-Path $PSScriptRoot 'extract_timbervision.py')
if ($LASTEXITCODE -ne 0) {
    throw "TimberVision archive verification/extraction failed with exit code $LASTEXITCODE"
}
& $python (Join-Path $PSScriptRoot 'prepare_timbervision.py')
if ($LASTEXITCODE -ne 0) {
    throw "YOLO segmentation dataset preparation failed with exit code $LASTEXITCODE"
}
