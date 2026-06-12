#!/usr/bin/env python3
"""Deeper migration readiness probe against live EC2 Supabase."""
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

env: dict[str, str] = {}
for line in Path(".env.local").read_text(encoding="utf-8").splitlines():
    m = re.match(r"^([^#=]+)=(.*)$", line.strip())
    if m:
        env[m.group(1).strip()] = m.group(2).strip().strip('"')

url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
key = env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")

# Login
login_body = json.dumps({"email": "tara@choice.example", "password": "password123"}).encode()
login_req = urllib.request.Request(
    f"{url}/auth/v1/token?grant_type=password",
    data=login_body,
    headers={"apikey": key, "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(login_req, timeout=15) as r:
    token = json.loads(r.read().decode())["access_token"]

headers = {
    "apikey": key,
    "Authorization": f"Bearer {token}",
    "Accept": "application/json",
    "Content-Type": "application/json",
}


def get(path: str) -> tuple[int, str]:
    req = urllib.request.Request(f"{url}{path}", headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def post(path: str, body: dict) -> tuple[int, str]:
    req = urllib.request.Request(
        f"{url}{path}",
        data=json.dumps(body).encode(),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def patch(path: str, body: dict) -> tuple[int, str]:
    req = urllib.request.Request(
        f"{url}{path}",
        data=json.dumps(body).encode(),
        headers={**headers, "Prefer": "return=minimal"},
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


out: dict[str, object] = {}

# Column probes via select
for col in [
    "supervising_atp_id",
    "snoozed_until",
]:
    code, body = get(f"/rest/v1/app_users?select={col}&limit=1")
    out[f"app_users.{col}"] = code == 200

code, body = get("/rest/v1/payers?select=type&limit=3")
out["payers_sample"] = json.loads(body) if code == 200 else body[:150]

# Get a NOT_STARTED task to test AWAITING_SIGNATURE
code, body = get("/rest/v1/tasks?select=id,status&status=eq.NOT_STARTED&limit=1")
tasks = json.loads(body) if code == 200 else []
out["awaiting_signature"] = "not_tested"
if tasks:
    tid = tasks[0]["id"]
    c, b = patch(f"/rest/v1/tasks?id=eq.{tid}", {"status": "AWAITING_SIGNATURE"})
    out["awaiting_signature"] = {"http": c, "ok": c in (200, 204), "hint": b[:200] if c not in (200, 204) else "ok"}
    if c in (200, 204):
        patch(f"/rest/v1/tasks?id=eq.{tid}", {"status": "NOT_STARTED"})

# RPC signature probe with dummy UUIDs (expect validation error, not 404)
rpc_body = {
    "p_first_name": "Test",
    "p_last_name": "Probe",
    "p_payer_id": "00000000-0000-0000-0000-000000000001",
    "p_assigned_rep_id": "00000000-0000-0000-0000-000000000004",
    "p_assigned_atp_id": "00000000-0000-0000-0000-000000000003",
}
c, b = post("/rest/v1/rpc/create_patient_with_tasks", rpc_body)
out["create_patient_rpc"] = {"http": c, "hint": b[:250]}

# List migrations implied
checks = {
    "0004_supervising_atp": out.get("app_users.supervising_atp_id"),
    "0007_task_link_events": True,  # confirmed earlier
    "0009_payer_types": False,  # confirmed 404
    "0011_awaiting_signature": isinstance(out.get("awaiting_signature"), dict) and out["awaiting_signature"].get("ok"),
    "0012_snoozed_until": out.get("app_users.snoozed_until") is False,  # wrong table - fix
    "0013_task_notes": False,
    "0014_notifications": False,
}
code, body = get("/rest/v1/tasks?select=snoozed_until&limit=1")
checks["0012_snoozed_until"] = code == 200
code, body = get("/rest/v1/task_notes?select=id&limit=1")
checks["0013_task_notes"] = code == 200
code, body = get("/rest/v1/notifications?select=id&limit=1")
checks["0014_notifications"] = code == 200

out["migration_checklist"] = checks
print(json.dumps(out, indent=2))
