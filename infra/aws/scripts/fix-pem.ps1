# Re-fetch or repair choice-tracker-key.pem (AWS create-key-pair must preserve PEM newlines).
param(
  [string]$Region = "us-west-2",
  [string]$KeyName = "choice-tracker-key"
)
$aws = "${env:ProgramFiles}\Amazon\AWSCLIV2\aws.exe"
$pemPath = Join-Path $env:USERPROFILE ".ssh\$KeyName.pem"

# If key exists in AWS, we cannot re-download — delete and recreate the key pair name.
$ErrorActionPreference = "Continue"
& $aws ec2 delete-key-pair --region $Region --key-name $KeyName 2>$null | Out-Null
$ErrorActionPreference = "Stop"

$json = & $aws ec2 create-key-pair --region $Region --key-name $KeyName --output json | ConvertFrom-Json
if (-not $json.KeyMaterial) { throw "create-key-pair failed" }

New-Item -ItemType Directory -Force -Path (Split-Path $pemPath) | Out-Null
if (Test-Path $pemPath) {
  icacls $pemPath /inheritance:e /grant:r "$($env:USERNAME):(F)" | Out-Null
  Remove-Item -Force $pemPath
}
Set-Content -Path $pemPath -Value $json.KeyMaterial -NoNewline -Encoding ascii
icacls $pemPath /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
Write-Host "Wrote $pemPath"
