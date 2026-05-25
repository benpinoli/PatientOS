# Point Amplify production at self-hosted Supabase on EC2 (via Next.js /supabase proxy).
# Usage:
#   $env:AMPLIFY_APP_ID = "d2na0dxbmaa2o4"
#   $env:AMPLIFY_BRANCH = "main"
#   $env:EC2_SUPABASE_URL = "http://44.253.198.43:8000"
#   $env:AMPLIFY_APP_URL = "https://main.d2na0dxbmaa2o4.amplifyapp.com"
#   $env:SUPABASE_ANON_KEY = "<from EC2 /opt/choice-supabase/.env>"
#   .\infra\aws\scripts\update-amplify-env.ps1

param(
  [string]$AppId = $env:AMPLIFY_APP_ID,
  [string]$Branch = $env:AMPLIFY_BRANCH,
  [string]$Ec2SupabaseUrl = $env:EC2_SUPABASE_URL,
  [string]$AmplifyAppUrl = $env:AMPLIFY_APP_URL,
  [string]$AnonKey = $env:SUPABASE_ANON_KEY
)

$ErrorActionPreference = "Stop"
$aws = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
if (-not (Test-Path $aws)) { $aws = "aws" }

if (-not $AppId -or -not $Branch -or -not $Ec2SupabaseUrl -or -not $AmplifyAppUrl -or -not $AnonKey) {
  Write-Host @"
Set these env vars before running:
  AMPLIFY_APP_ID, AMPLIFY_BRANCH, EC2_SUPABASE_URL, AMPLIFY_APP_URL, SUPABASE_ANON_KEY
"@
  exit 1
}

$proxyUrl = "$($AmplifyAppUrl.TrimEnd('/'))/supabase"

$envVars = @{
  SUPABASE_INTERNAL_URL = $Ec2SupabaseUrl
  NEXT_PUBLIC_SUPABASE_URL = $proxyUrl
  NEXT_PUBLIC_APP_URL = $AmplifyAppUrl.TrimEnd('/')
  NEXT_PUBLIC_SUPABASE_ANON_KEY = $AnonKey
  NEXT_PUBLIC_AUTH_AZURE_ENABLED = "false"
  NEXT_PUBLIC_AUTH_GOOGLE_ENABLED = "false"
  NEXT_PUBLIC_AUTH_EMAIL_ENABLED = "true"
}
$envJson = ConvertTo-Json -InputObject $envVars -Compress
$envFile = Join-Path $env:TEMP "amplify-env-$AppId-$Branch.json"
[System.IO.File]::WriteAllText($envFile, "{`"environmentVariables`": $envJson}")

& $aws amplify update-branch `
  --app-id $AppId `
  --branch-name $Branch `
  --region us-west-2 `
  --cli-input-json "file://$($envFile -replace '\\','/')"

Remove-Item -Force $envFile -ErrorAction SilentlyContinue

Write-Host "Updated Amplify branch $Branch"
Write-Host "  SUPABASE_INTERNAL_URL = $Ec2SupabaseUrl"
Write-Host "  NEXT_PUBLIC_SUPABASE_URL = $proxyUrl"
Write-Host "Trigger a new deploy in Amplify Console (or push to $Branch)."
