# Apply pending DB migrations on EC2 from Windows (SSH + optional SG fix).
# Prerequisites: AWS CLI configured (us-west-2), SSH key at %USERPROFILE%\.ssh\choice-tracker-key.pem
#
# If SSH still fails, use the browser method in DEPLOYMENT.md § "Can't SSH?"
param(
  [string]$Region = "us-west-2",
  [string]$InstanceId = "i-0ceb5f7f69abea322",
  [string]$HostIp = "32.185.154.166",
  [string]$KeyName = "choice-tracker-key",
  [string]$SgName = "choice-tracker-sg",
  [string]$SshUser = "ubuntu"
)

$ErrorActionPreference = "Stop"
$aws = "${env:ProgramFiles}\Amazon\AWSCLIV2\aws.exe"
if (-not (Test-Path $aws)) {
  Write-Host "AWS CLI not found. Run: .\infra\aws\scripts\install-aws-cli.ps1"
  exit 1
}

$pemPath = Join-Path $env:USERPROFILE ".ssh\$KeyName.pem"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path

Write-Host "=== Choice Healthcare — apply migrations on EC2 ===" -ForegroundColor Cyan
Write-Host "Instance: $InstanceId  IP: $HostIp  Region: $Region"
Write-Host ""

# 1) Key file
if (-not (Test-Path $pemPath)) {
  Write-Host "MISSING SSH key: $pemPath" -ForegroundColor Red
  Write-Host @"

Options:
  A) Ask whoever ran launch-ec2.ps1 for the .pem file (only downloadable once at create time).
  B) EC2 Instance Connect in the browser (no .pem) — see DEPLOYMENT.md § Can't SSH?
  C) If you own the AWS account AND the instance was launched with key $KeyName,
     fix-pem.ps1 recreates the key pair name but cannot unlock an existing instance
     unless you also attach the new key (advanced).

"@
  exit 1
}
Write-Host "OK  SSH key found: $pemPath"

# 2) PEM permissions (Windows OpenSSH requires restricted ACL)
icacls $pemPath /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null

# 3) Allow SSH from this PC's current public IP (common failure: IP changed since launch)
try {
  $myIp = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com" -TimeoutSec 10).Trim()
  Write-Host "OK  Your public IP: $myIp"
  $sgId = (& $aws ec2 describe-security-groups --region $Region `
    --filters "Name=group-name,Values=$SgName" `
    --query "SecurityGroups[0].GroupId" --output text 2>$null)
  if ($sgId -and $sgId -ne "None") {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $aws ec2 authorize-security-group-ingress --region $Region --group-id $sgId `
      --protocol tcp --port 22 --cidr "$myIp/32" 2>&1 | Out-Null
    $ErrorActionPreference = $prev
    Write-Host "OK  Security group $SgName ($sgId): ensured SSH (port 22) from $myIp/32"
  }
} catch {
  Write-Host "WARN Could not update security group (need ec2:AuthorizeSecurityGroupIngress): $_"
}

# 4) Test SSH
Write-Host ""
Write-Host "Testing SSH..."
$testCmd = "echo connected && hostname && test -d /opt/choice-supabase && echo supabase_ok"
ssh -i $pemPath -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 `
  "${SshUser}@${HostIp}" $testCmd 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "SSH failed. Use the browser method instead:" -ForegroundColor Yellow
  Write-Host "  1. AWS Console → EC2 → Instances → $InstanceId → Connect"
  Write-Host "  2. Tab: EC2 Instance Connect → Connect"
  Write-Host "  3. Paste: infra/aws/scripts/apply-migrations-browser-shell.sh (or run line-by-line)"
  Write-Host "  See DEPLOYMENT.md § Can't SSH?"
  exit 1
}

Write-Host ""
Write-Host "SSH OK. Copying repo scripts and applying migrations..."

ssh -i $pemPath -o StrictHostKeyChecking=accept-new "${SshUser}@${HostIp}" "rm -rf /tmp/choice-infra /tmp/choice-repo && mkdir -p /tmp/choice-infra /tmp/choice-repo/supabase"

scp -i $pemPath -o StrictHostKeyChecking=accept-new -r `
  (Join-Path $repoRoot "infra\aws\scripts") `
  "${SshUser}@${HostIp}:/tmp/choice-infra/"

scp -i $pemPath -o StrictHostKeyChecking=accept-new -r `
  (Join-Path $repoRoot "supabase\migrations") `
  "${SshUser}@${HostIp}:/tmp/choice-repo/supabase/"

$remoteScript = @"
set -euo pipefail
export REPO_ROOT=/tmp/choice-repo
export INSTALL_DIR=/opt/choice-supabase
bash /tmp/choice-infra/scripts/apply-pending-migrations.sh
"@

ssh -i $pemPath -o StrictHostKeyChecking=accept-new "${SshUser}@${HostIp}" $remoteScript

Write-Host ""
Write-Host "=== Migrations finished ===" -ForegroundColor Green
Write-Host "Try Sent for signature in the app again."
