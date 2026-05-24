# Install AWS CLI v2 on Windows (run in elevated PowerShell if winget fails).
$ErrorActionPreference = "Stop"

$cli = "${env:ProgramFiles}\Amazon\AWSCLIV2\aws.exe"
if (Test-Path $cli) {
  Write-Host "AWS CLI already installed:" (& $cli --version)
  exit 0
}

Write-Host "Installing AWS CLI via winget..."
winget install -e --id Amazon.AWSCLI --accept-package-agreements --accept-source-agreements

if (Test-Path $cli) {
  Write-Host "Installed:" (& $cli --version)
  Write-Host "Next: aws configure   (region: us-west-2)"
} else {
  Write-Host "Winget failed. Download MSI: https://aws.amazon.com/cli/"
}
