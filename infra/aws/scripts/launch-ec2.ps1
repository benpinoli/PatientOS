# Creates EC2 + security group + Elastic IP for self-hosted Supabase (HANDOFF step 2).
# Prerequisites: AWS CLI configured (us-west-2), OpenSSH key .pem saved locally.
param(
  [string]$Region = "us-west-2",
  [string]$KeyName = "choice-tracker-key",
  [string]$InstanceType = "t4g.small",
  [string]$SgName = "choice-tracker-sg",
  [string]$InstanceName = "choice-supabase"
)

$ErrorActionPreference = "Stop"
$aws = "${env:ProgramFiles}\Amazon\AWSCLIV2\aws.exe"
if (-not (Test-Path $aws)) { throw "AWS CLI not found. Run: .\infra\aws\scripts\install-aws-cli.ps1" }

& $aws sts get-caller-identity --region $Region | Out-Null

$myIp = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com").Trim()
Write-Host "Your public IP: $myIp"

$vpcId = (& $aws ec2 describe-vpcs --region $Region --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)
$subnetId = (& $aws ec2 describe-subnets --region $Region --filters "Name=vpc-id,Values=$vpcId" "Name=default-for-az,Values=true" --query "Subnets[0].SubnetId" --output text)

# Security group
$sgId = (& $aws ec2 describe-security-groups --region $Region --filters "Name=group-name,Values=$SgName" --query "SecurityGroups[0].GroupId" --output text 2>$null)
if ($sgId -eq "None" -or -not $sgId) {
  $sgId = (& $aws ec2 create-security-group --region $Region --group-name $SgName --description "Choice tracker Supabase" --vpc-id $vpcId --query GroupId --output text)
  Write-Host "Created security group: $sgId"
} else {
  Write-Host "Using existing security group: $sgId"
}

function Ensure-SgRule {
  param([int]$Port, [string]$Cidr)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $out = & $aws ec2 authorize-security-group-ingress --region $Region --group-id $sgId `
    --protocol tcp --port $Port --cidr $Cidr 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -ne 0 -and $out -notmatch "InvalidPermission.Duplicate") {
    throw "SG rule port $Port failed: $out"
  }
}
Ensure-SgRule -Port 22 -Cidr "$myIp/32"
Ensure-SgRule -Port 80 -Cidr "0.0.0.0/0"
Ensure-SgRule -Port 443 -Cidr "0.0.0.0/0"
Ensure-SgRule -Port 8000 -Cidr "0.0.0.0/0"

# Key pair (create once)
$pemPath = Join-Path $env:USERPROFILE ".ssh\$KeyName.pem"
if (-not (Test-Path $pemPath)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $pemPath) | Out-Null
  $kp = & $aws ec2 create-key-pair --region $Region --key-name $KeyName --output json | ConvertFrom-Json
  if (-not $kp.KeyMaterial) { throw "create-key-pair failed" }
  Set-Content -Path $pemPath -Value $kp.KeyMaterial -NoNewline -Encoding ascii
  icacls $pemPath /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  Write-Host "Saved key: $pemPath"
} else {
  Write-Host "Using existing key: $pemPath"
}

$ami = (& $aws ec2 describe-images --region $Region --owners 099720109477 `
  --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*" "Name=state,Values=available" `
  --query "sort_by(Images, &CreationDate)[-1].ImageId" --output text)

Write-Host "Launching $InstanceType with AMI $ami ..."
$instanceId = (& $aws ec2 run-instances --region $Region `
  --image-id $ami `
  --instance-type $InstanceType `
  --key-name $KeyName `
  --security-group-ids $sgId `
  --subnet-id $subnetId `
  --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=30,Encrypted=true,DeleteOnTermination=true}" `
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$InstanceName}]" `
  --query "Instances[0].InstanceId" --output text)

Write-Host "Waiting for instance $instanceId ..."
& $aws ec2 wait instance-running --region $Region --instance-ids $instanceId

$alloc = (& $aws ec2 allocate-address --region $Region --domain vpc --query AllocationId --output text)
& $aws ec2 associate-address --region $Region --instance-id $instanceId --allocation-id $alloc | Out-Null
$eip = (& $aws ec2 describe-addresses --region $Region --allocation-ids $alloc --query "Addresses[0].PublicIp" --output text)

Write-Host ""
Write-Host "EC2 ready."
Write-Host "  Instance: $instanceId"
Write-Host "  Elastic IP: $eip"
Write-Host "  SSH: ssh -i `"$env:USERPROFILE\.ssh\$KeyName.pem`" ubuntu@$eip"
Write-Host ""
Write-Host "Next:"
Write-Host "  1. scp -r infra/aws/scripts ubuntu@${eip}:/tmp/"
Write-Host "  2. ssh ubuntu@$eip 'bash /tmp/scripts/bootstrap-ec2.sh'"
Write-Host "  3. Set DATABASE_URL and run apply-schema.sh"
