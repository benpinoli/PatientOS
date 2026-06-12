# Launch a NEW EC2 instance with cloud-init bootstrap (no SSH required for setup).
# Also opens SSH from your current IP + temporarily from anywhere so EC2 Instance Connect works.
#
# Usage (from repo root):
#   .\infra\aws\scripts\launch-fresh-ec2.ps1
#   .\infra\aws\scripts\launch-fresh-ec2.ps1 -TerminateOld   # stops billing on old instance
#
param(
  [string]$Region = "us-west-2",
  [string]$KeyName = "choice-tracker-key-v2",
  [string]$InstanceType = "t4g.small",
  [string]$SgName = "choice-tracker-sg-v2",
  [string]$InstanceName = "choice-supabase-v2",
  [switch]$TerminateOld
)

$ErrorActionPreference = "Stop"
$aws = "${env:ProgramFiles}\Amazon\AWSCLIV2\aws.exe"
if (-not (Test-Path $aws)) { throw "AWS CLI not found. Run: .\infra\aws\scripts\install-aws-cli.ps1" }

& $aws sts get-caller-identity --region $Region | Out-Null

$myIp = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com").Trim()
Write-Host "Your public IP: $myIp"

$vpcId = (& $aws ec2 describe-vpcs --region $Region --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)
$subnetId = (& $aws ec2 describe-subnets --region $Region --filters "Name=vpc-id,Values=$vpcId" "Name=default-for-az,Values=true" --query "Subnets[0].SubnetId" --output text)

# Security group (new v2 group so we don't fight old rules)
$sgId = (& $aws ec2 describe-security-groups --region $Region --filters "Name=group-name,Values=$SgName" --query "SecurityGroups[0].GroupId" --output text 2>$null)
if ($sgId -eq "None" -or -not $sgId) {
  $sgId = (& $aws ec2 create-security-group --region $Region --group-name $SgName --description "Choice tracker Supabase v2" --vpc-id $vpcId --query GroupId --output text)
  Write-Host "Created security group: $sgId"
} else {
  Write-Host "Using existing security group: $sgId"
}

function Ensure-SgRule {
  param([int]$Port, [string]$Cidr, [string]$Desc = "")
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $args = @(
    "ec2", "authorize-security-group-ingress", "--region", $Region,
    "--group-id", $sgId, "--protocol", "tcp", "--port", $Port, "--cidr", $Cidr
  )
  if ($Desc) { $args += @("--tag-specifications", "ResourceType=security-group-rule,Tags=[{Key=Description,Value=$Desc}]") }
  $out = & $aws @args 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -ne 0 -and $out -notmatch "InvalidPermission.Duplicate") {
    throw "SG rule port $Port failed: $out"
  }
}

Ensure-SgRule -Port 22 -Cidr "$myIp/32" -Desc "Admin SSH from current IP"
Ensure-SgRule -Port 22 -Cidr "0.0.0.0/0" -Desc "TEMP EC2 Instance Connect - lock down after setup"
Ensure-SgRule -Port 80 -Cidr "0.0.0.0/0"
Ensure-SgRule -Port 443 -Cidr "0.0.0.0/0"
Ensure-SgRule -Port 8000 -Cidr "0.0.0.0/0"

# Key pair
$pemPath = Join-Path $env:USERPROFILE ".ssh\$KeyName.pem"
if (-not (Test-Path $pemPath)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $pemPath) | Out-Null
  $kp = & $aws ec2 create-key-pair --region $Region --key-name $KeyName --output json | ConvertFrom-Json
  if (-not $kp.KeyMaterial) { throw "create-key-pair failed" }
  Set-Content -Path $pemPath -Value $kp.KeyMaterial -NoNewline -Encoding ascii
  icacls $pemPath /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  Write-Host "Saved new key: $pemPath"
} else {
  Write-Host "Using existing key: $pemPath"
}

# User-data bootstrap script (base64 for run-instances)
$bootstrapPath = Join-Path $PSScriptRoot "ec2-user-data-bootstrap.sh"
if (-not (Test-Path $bootstrapPath)) { throw "Missing $bootstrapPath" }
$userDataRaw = Get-Content -Raw -Path $bootstrapPath -Encoding UTF8
$userDataB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($userDataRaw))

$ami = (& $aws ec2 describe-images --region $Region --owners 099720109477 `
  --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*" "Name=state,Values=available" `
  --query "sort_by(Images, &CreationDate)[-1].ImageId" --output text)

Write-Host "Launching $InstanceType ($InstanceName) ..."
$instanceId = (& $aws ec2 run-instances --region $Region `
  --image-id $ami `
  --instance-type $InstanceType `
  --key-name $KeyName `
  --security-group-ids $sgId `
  --subnet-id $subnetId `
  --user-data $userDataB64 `
  --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=30,Encrypted=true,DeleteOnTermination=true}" `
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$InstanceName}]" `
  --query "Instances[0].InstanceId" --output text)

Write-Host "Waiting for instance $instanceId to run ..."
& $aws ec2 wait instance-running --region $Region --instance-ids $instanceId

$alloc = (& $aws ec2 allocate-address --region $Region --domain vpc --query AllocationId --output text)
& $aws ec2 associate-address --region $Region --instance-id $instanceId --allocation-id $alloc | Out-Null
$eip = (& $aws ec2 describe-addresses --region $Region --allocation-ids $alloc --query "Addresses[0].PublicIp" --output text)

Write-Host ""
Write-Host "========================================"
Write-Host " NEW EC2 INSTANCE READY"
Write-Host "========================================"
Write-Host "  Instance ID:  $instanceId"
Write-Host "  Elastic IP:   $eip"
Write-Host "  Security SG:  $sgId"
Write-Host "  SSH key:      $pemPath"
Write-Host "  Supabase API: http://${eip}:8000"
Write-Host ""
Write-Host "Bootstrap is running via cloud-init (~5-10 min)."
Write-Host "  Log (after SSH works): sudo tail -f /var/log/choice-bootstrap.log"
Write-Host ""
Write-Host "EC2 Instance Connect should work now (SSH open temporarily)."
Write-Host "  EC2 -> Instances -> $instanceId -> Connect -> EC2 Instance Connect"
Write-Host ""
Write-Host "Or SSH from this PC:"
Write-Host "  ssh -i `"$pemPath`" ubuntu@$eip"
Write-Host ""
Write-Host "After bootstrap finishes, copy keys:"
Write-Host "  ssh -i `"$pemPath`" ubuntu@$eip `"sudo grep -E '^ANON_KEY=|^SERVICE_ROLE_KEY=' /opt/choice-supabase/.env`""
Write-Host ""
Write-Host "Update .env.local:"
Write-Host "  NEXT_PUBLIC_SUPABASE_URL=http://${eip}:8000"
Write-Host ""
Write-Host "Update Amplify (set SUPABASE_ANON_KEY first):"
Write-Host "  `$env:EC2_SUPABASE_URL = `"http://${eip}:8000`""
Write-Host "  .\infra\aws\scripts\update-amplify-env.ps1"
Write-Host "========================================"

# Write quick reference file
$refPath = Join-Path (Split-Path $PSScriptRoot -Parent) "NEW-EC2-INSTANCE.txt"
@"
Choice Healthcare — new EC2 instance $(Get-Date -Format 'yyyy-MM-dd HH:mm')
Instance ID: $instanceId
Elastic IP:  $eip
Security group: $sgId
SSH key: $pemPath
Supabase API: http://${eip}:8000
Old instance (if any): i-0c55b5678f0ec6cf7 @ 44.253.198.43
"@ | Set-Content -Path $refPath -Encoding UTF8
Write-Host "Saved reference: $refPath"

if ($TerminateOld) {
  $oldId = "i-0c55b5678f0ec6cf7"
  Write-Host "Terminating old instance $oldId ..."
  & $aws ec2 terminate-instances --region $Region --instance-ids $oldId | Out-Null
  Write-Host "Old instance termination requested (Elastic IP on old box is NOT auto-released)."
}
