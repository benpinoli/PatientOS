#!/usr/bin/env python3
"""Probe live Supabase REST API for schema readiness (no secrets printed)."""
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
service = env.get("SUPABASE_SERVICE_ROLE_KEY", "")

headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Accept": "application/json",
}


def probe(path: str, use_service: bool = False) -> tuple[int, str]:
    h = dict(headers)
    if use_service and service:
        h["apikey"] = service
        h["Authorization"] = f"Bearer {service}"
    req = urllib.request.Request(f"{url}{path}", headers=h, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


results: dict[str, object] = {
    "supabase_url": url,
    "service_role_configured": bool(service),
}

tables = ["tasks", "task_notes", "notifications", "task_link_events", "payer_types"]
table_status = {}
for table in tables:
    code, body = probe(f"/rest/v1/{table}?select=id&limit=1")
    table_status[table] = {
        "http": code,
        "exists": code == 200,
        "error_hint": None if code == 200 else body[:200],
    }
results["tables"] = table_status

code, body = probe("/rest/v1/tasks?select=snoozed_until&limit=1")
results["snoozed_until_column"] = {
    "http": code,
    "present": code == 200 and "snoozed_until" in body,
    "error_hint": None if code == 200 else body[:200],
}

# notifications readable with anon (unauthenticated will fail - expected)
code, body = probe("/rest/v1/notifications?select=id&limit=1")
results["notifications_anon_unauth"] = code

# Try login with seed user to get JWT and re-probe
email = "tara@choice.example"
password = "password123"
login_body = json.dumps({"email": email, "password": password}).encode()
login_req = urllib.request.Request(
    f"{url}/auth/v1/token?grant_type=password",
    data=login_body,
    headers={
        "apikey": key,
        "Content-Type": "application/json",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(login_req, timeout=15) as r:
        token = json.loads(r.read().decode())["access_token"]
    auth_headers = {
        "apikey": key,
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }

    def auth_probe(path: str) -> tuple[int, str]:
        req = urllib.request.Request(f"{url}{path}", headers=auth_headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    c1, b1 = auth_probe("/rest/v1/tasks?select=status&limit=5")
    statuses = {row.get("status") for row in json.loads(b1) if isinstance(row, dict)}
    results["auth_login"] = "ok"
    results["sample_task_statuses"] = sorted(statuses)

    c2, b2 = auth_probe("/rest/v1/task_notes?select=id&limit=1")
    results["task_notes_authed"] = c2

    c3, b3 = auth_probe("/rest/v1/notifications?select=id&limit=1")
    results["notifications_authed"] = c3

    # RPC exists?
    rpc_req = urllib.request.Request(
        f"{url}/rest/v1/rpc/create_patient_with_tasks",
        data=b"{}",
        headers={**auth_headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(rpc_req, timeout=15) as r:
            results["rpc_create_patient"] = r.status
    except urllib.error.HTTPError as e:
        body_rpc = e.read().decode()
        results["rpc_create_patient"] = {
            "http": e.code,
            "exists": "create_patient_with_tasks" in body_rpc or e.code in (400, 401, 403, 422),
            "hint": body_rpc[:200],
        }

except urllib.error.HTTPError as e:
    results["auth_login"] = {"http": e.code, "body": e.read().decode()[:200]}
except Exception as e:
    results["auth_login"] = str(e)

print(json.dumps(results, indent=2))
