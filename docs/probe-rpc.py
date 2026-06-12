#!/usr/bin/env python3
import json, re, urllib.request, urllib.error
from pathlib import Path

env = {}
for line in Path(".env.local").read_text().splitlines():
    m = re.match(r"^([^#=]+)=(.*)$", line.strip())
    if m:
        env[m.group(1)] = m.group(2).strip().strip('"')

url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
key = env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
login = json.dumps({"email": "tara@choice.example", "password": "password123"}).encode()
req = urllib.request.Request(
    url + "/auth/v1/token?grant_type=password",
    data=login,
    headers={"apikey": key, "Content-Type": "application/json"},
    method="POST",
)
token = json.loads(urllib.request.urlopen(req, timeout=15).read())["access_token"]
h = {"apikey": key, "Authorization": "Bearer " + token, "Content-Type": "application/json"}

for rpc in ["update_app_user", "create_patient_with_tasks"]:
    req = urllib.request.Request(
        url + "/rest/v1/rpc/" + rpc,
        data=b"{}",
        headers=h,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            print(rpc, r.status, r.read().decode()[:200])
    except urllib.error.HTTPError as e:
        print(rpc, e.code, e.read().decode()[:250])
