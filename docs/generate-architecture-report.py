#!/usr/bin/env python3
"""Generate Choice Healthcare Tracker architecture & infrastructure PDF."""

from datetime import date
from pathlib import Path

from fpdf import FPDF

OUT = Path(__file__).resolve().parent / "Choice-Healthcare-Tracker-Architecture-Report.pdf"


class ReportPDF(FPDF):
    def header(self):
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, "Choice Healthcare Patient Pipeline Tracker", align="R")
        self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")

    def section_title(self, title: str):
        self.ln(4)
        self.set_font("Helvetica", "B", 14)
        self.set_text_color(20, 60, 100)
        self.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(20, 60, 100)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(4)

    def sub_title(self, title: str):
        self.ln(2)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(40, 40, 40)
        self.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def body(self, text: str):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5.5, text)
        self.ln(2)

    def bullet(self, text: str):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        x = self.l_margin
        self.set_x(x)
        self.cell(5, 5.5, chr(149))
        self.multi_cell(0, 5.5, text)
        self.ln(1)

    def table_row(self, cols, widths, bold=False, fill=False):
        style = "B" if bold else ""
        self.set_font("Helvetica", style, 9)
        if fill:
            self.set_fill_color(240, 245, 250)
        else:
            self.set_fill_color(255, 255, 255)
        self.set_text_color(30, 30, 30)
        h = 7
        for col, w in zip(cols, widths):
            self.cell(w, h, col, border=1, fill=fill)
        self.ln(h)


def build():
    pdf = ReportPDF()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    # Cover
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_text_color(20, 60, 100)
    pdf.ln(30)
    pdf.cell(0, 12, "Choice Healthcare", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.cell(0, 12, "Patient Pipeline Tracker", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(8)
    pdf.set_font("Helvetica", "", 14)
    pdf.set_text_color(60, 60, 60)
    pdf.cell(0, 10, "Architecture, AWS & Database Report", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 11)
    pdf.cell(0, 8, f"Generated: {date.today().strftime('%B %d, %Y')}", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.cell(0, 8, "Version 1 (tracker only - no document storage)", new_x="LMARGIN", new_y="NEXT", align="C")

    pdf.add_page()
    pdf.section_title("1. Executive Summary")
    pdf.body(
        "Choice Healthcare built an internal web application to replace scattered spreadsheets and email "
        "chains for tracking custom power-wheelchair prior-authorization workflows. Each patient gets a "
        "shared, prioritized checklist of tasks. Reps drive the workflow forward; ATPs (Assistive Technology "
        "Professionals) approve gated clinical tasks; Managers see their team's patients; the Boss has full "
        "visibility. The app does not store documents in v1 - tasks may link to external URLs (e.g. Google Drive)."
    )
    pdf.body(
        "The system is split across two AWS services: AWS Amplify hosts the Next.js web application, and an "
        "AWS EC2 instance hosts a self-hosted open-source Supabase stack (Postgres 17, GoTrue Auth, PostgREST, "
        "Kong API gateway). The database is NOT on your local development computer - it runs in the cloud on EC2."
    )

    pdf.section_title("2. What Was Built")
    pdf.sub_title("Application features (v1)")
    for item in [
        "Microsoft/Azure OAuth login (primary for production) plus email/password for dev/pilot users.",
        "Role-based visibility: REP, ATP, MANAGER, BOSS - stored as a text array on each user profile.",
        "Patient list and detail pages with a full per-patient task checklist snapshotted from templates.",
        "New-patient form that atomically creates a patient row and instantiates tasks from payer-type templates.",
        "Dashboard priority queue that surfaces the most urgent open tasks across all visible patients.",
        "Inline task editing: status, due dates, priority, links, blocked reasons, and 'Sent for signature' status.",
        "ATP approval gate enforced in the database - only the assigned ATP (or Boss, or solo-case rep/ATP) can approve gated tasks.",
        "Admin panel: activate users, assign roles, manage payer types, edit task templates, create/delete accounts.",
        "Task link history table tracking each document URL submission per task.",
    ]:
        pdf.bullet(item)

    pdf.sub_title("Technology stack")
    pdf.bullet("Frontend: Next.js 16.2 (App Router), React 19.2, Tailwind CSS 4.")
    pdf.bullet("Backend data layer: Supabase open-source - Postgres 17 + Row-Level Security (RLS).")
    pdf.bullet("Client libraries: @supabase/ssr for cookie-based auth in server components and browser.")
    pdf.bullet("Auth middleware: src/proxy.ts refreshes session cookies and redirects unauthenticated users to /login.")

    pdf.section_title("3. AWS Architecture")
    pdf.body(
        "Production uses a two-tier AWS layout. The website and the database are separate resources with "
        "different update paths."
    )
    w = [55, 55, 80]
    pdf.table_row(["Component", "AWS Service", "Role"], w, bold=True, fill=True)
    pdf.table_row(["Web application", "AWS Amplify", "Hosts Next.js UI; rebuilds on git push to main"], w)
    pdf.table_row(["Database + Auth API", "EC2 (Elastic IP)", "Self-hosted Supabase in Docker at /opt/choice-supabase"], w)

    pdf.ln(4)
    pdf.sub_title("Production identifiers")
    pdf.table_row(["Item", "Value"], [90, 100], bold=True, fill=True)
    for row in [
        ("Live app URL", "https://main.d2na0dxbmaa2o4.amplifyapp.com"),
        ("Amplify app ID", "d2na0dxbmaa2o4"),
        ("AWS region", "us-west-2 (US West, Oregon)"),
        ("EC2 instance ID", "i-0ceb5f7f69abea322"),
        ("EC2 public IP (Elastic IP)", "32.185.154.166"),
        ("Instance type", "t4g.small, Ubuntu 22.04, 30 GB encrypted EBS"),
        ("Security group", "sg-09cf02af40a8a785f (choice-tracker-sg-v2)"),
        ("Supabase API (Kong)", "http://32.185.154.166:8000"),
        ("Supabase install path", "/opt/choice-supabase"),
        ("Postgres port", "5432 - internal to Docker only; NOT open to the public internet"),
    ]:
        pdf.table_row(list(row), [90, 100])

    pdf.ln(4)
    pdf.sub_title("Request flow")
    pdf.body(
        "Browser -> AWS Amplify (HTTPS Next.js app)\n"
        "         -> For production: Next.js rewrites /supabase/* to EC2 Kong gateway (HTTP :8000)\n"
        "         -> Kong routes to GoTrue (auth) or PostgREST (database API)\n"
        "         -> Postgres 17 stores all patient/task/user data with RLS policies\n\n"
        "This HTTPS proxy pattern exists because browsers block HTTPS pages from calling plain HTTP APIs "
        "(mixed-content policy). Amplify sets SUPABASE_INTERNAL_URL to the EC2 address and "
        "NEXT_PUBLIC_SUPABASE_URL to https://<amplify-app>/supabase so all API traffic is same-origin HTTPS."
    )

    pdf.sub_title("What updates when you change things")
    pdf.bullet("UI changes, buttons, labels -> git push -> Amplify auto-rebuilds (minutes).")
    pdf.bullet("Schema changes (new columns, statuses, tables, RLS) -> run SQL migrations on EC2 (manual, via SSH or browser terminal).")
    pdf.bullet("App env vars (Supabase URL, keys) -> AWS Amplify Console environment variables.")

    pdf.section_title("4. Where Is the Database Hosted?")
    pdf.body(
        "The authoritative database is hosted on the AWS EC2 instance at 32.185.154.166. It runs inside Docker "
        "containers as part of the self-hosted Supabase stack cloned to /opt/choice-supabase on that server."
    )
    pdf.sub_title("Is Supabase on this computer?")
    pdf.body(
        "No - not for production or current local development on this machine. Findings from this workstation:\n"
        "  - Supabase CLI is NOT installed (supabase command not found).\n"
        "  - Docker Desktop is NOT running (no local containers).\n"
        "  - .env.local points NEXT_PUBLIC_SUPABASE_URL to http://32.185.154.166:8000 (remote EC2).\n\n"
        "The repo includes supabase/config.toml and supabase/migrations/ for local development via "
        "'supabase start' (ports 54321/54322/54323), but that local stack is optional and is not currently "
        "active on this machine. When used, it would run Postgres in Docker on localhost - separate from the "
        "production EC2 database."
    )
    pdf.sub_title("Retired hosting")
    pdf.body(
        "An earlier managed Supabase Cloud project (ftxxexwzrhyrqjguagbi.supabase.co) was used during initial "
        "development with synthetic seed data. The project has been superseded by self-hosted Supabase on EC2 "
        "to avoid managed HIPAA-tier costs. Do not use the cloud project for new deployments."
    )

    pdf.section_title("5. API Keys and Secrets")
    pdf.body(
        "This section describes which keys exist and where they are used. Actual secret values are NOT "
        "included in this report - they live in environment files and the EC2 server, never in git."
    )
    pdf.sub_title("Application environment variables")
    w3 = [65, 45, 80]
    pdf.table_row(["Variable", "Exposure", "Purpose"], w3, bold=True, fill=True)
    rows = [
        ("NEXT_PUBLIC_SUPABASE_URL", "Public (browser)", "Supabase API base URL. Local dev: EC2 :8000. Prod: Amplify /supabase proxy."),
        ("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Public (browser)", "JWT anon key - authenticates as 'authenticated' role. Respects RLS."),
        ("SUPABASE_SERVICE_ROLE_KEY", "Server-only", "Bypasses RLS. Used for admin.auth.createUser/deleteUser only."),
        ("SUPABASE_INTERNAL_URL", "Server-only (Amplify)", "EC2 Kong URL for Next.js rewrite proxy in production."),
        ("NEXT_PUBLIC_APP_URL", "Public", "Base URL for OAuth callbacks and sign-out redirects."),
        ("NEXT_PUBLIC_AUTH_*_ENABLED", "Public", "Feature flags for Azure, Google, email login providers."),
        ("SUPABASE_AUTH_EXTERNAL_AZURE_*", "Server/Supabase", "Microsoft Entra OAuth client ID and secret."),
    ]
    for r in rows:
        pdf.table_row(list(r), w3)

    pdf.ln(3)
    pdf.sub_title("EC2 Supabase stack keys (/opt/choice-supabase/.env)")
    pdf.bullet("ANON_KEY - same JWT anon key surfaced to the Next.js app as NEXT_PUBLIC_SUPABASE_ANON_KEY.")
    pdf.bullet("SERVICE_ROLE_KEY - same as SUPABASE_SERVICE_ROLE_KEY in Amplify/server env.")
    pdf.bullet("JWT_SECRET - signs auth tokens inside GoTrue; never sent to the browser.")
    pdf.bullet("POSTGRES_PASSWORD - database superuser password; used only inside Docker.")
    pdf.bullet("SITE_URL / API_EXTERNAL_URL / SUPABASE_PUBLIC_URL - OAuth redirect configuration.")

    pdf.sub_title("Current workstation (.env.local) status")
    pdf.bullet("NEXT_PUBLIC_SUPABASE_URL = http://32.185.154.166:8000 (remote EC2, not localhost).")
    pdf.bullet("NEXT_PUBLIC_SUPABASE_ANON_KEY = configured (212-character JWT).")
    pdf.bullet("SUPABASE_SERVICE_ROLE_KEY = not set in .env.local (admin user create/delete requires it).")
    pdf.bullet("NEXT_PUBLIC_AUTH_EMAIL_ENABLED = true; Azure and Google = false.")

    pdf.sub_title("AWS deployment keys (not in application code)")
    pdf.bullet("IAM access keys - used by developers for AWS CLI (EC2 launch, Amplify env updates). Rotate after bootstrap.")
    pdf.bullet("SSH key pair choice-tracker-key.pem - stored at %USERPROFILE%\\.ssh\\ for EC2 admin access.")
    pdf.bullet("These are infrastructure credentials, separate from Supabase JWT keys.")

    pdf.section_title("6. Database Schema")
    pdf.body(
        "Postgres 17 database 'postgres', schema 'public'. All tables have Row-Level Security enabled. "
        "Eleven migration files (0001 through 0011) define the current schema."
    )
    pdf.sub_title("Core tables")
    w4 = [40, 130]
    pdf.table_row(["Table", "Description"], w4, bold=True, fill=True)
    tables = [
        ("app_users", "User profiles linked 1:1 to auth.users. Roles[], manager_id, supervising_atp_id, active flag."),
        ("payers", "Insurance payers (name + type). Type FK references payer_types.code."),
        ("payer_types", "Admin-managed workflow categories: MEDICARE, MEDICAID, COMMERCIAL (+ custom)."),
        ("patients", "Patient + active case merged. Names, payer, assigned rep/ATP, pursuit status."),
        ("task_templates", "Master checklist per payer type. Label, role, ATP-review flag, order."),
        ("tasks", "Per-patient instantiated checklist. Snapshotted from template; holds status, dates, link."),
        ("task_link_events", "History of link submissions per task (who posted, when, URL or 'via other means')."),
    ]
    for t, d in tables:
        pdf.table_row([t, d], w4)

    pdf.ln(3)
    pdf.sub_title("Entity relationships")
    pdf.body(
        "app_users.manager_id -> app_users (org hierarchy)\n"
        "app_users.supervising_atp_id -> app_users (default ATP for reps)\n"
        "patients.payer_id -> payers.id\n"
        "payers.type -> payer_types.code\n"
        "patients.assigned_rep_id / assigned_atp_id -> app_users.id\n"
        "tasks.patient_id -> patients.id (cascade delete)\n"
        "tasks.template_id -> task_templates.id (set null on delete)\n"
        "task_link_events.task_id -> tasks.id (cascade delete)"
    )

    pdf.sub_title("Allowed status and role values")
    pdf.bullet("User roles: ATP, REP, MANAGER, BOSS (multi-valued array).")
    pdf.bullet("Patient status: ACTIVE, SUBMITTED, APPROVED, DENIED, DELIVERED, CLOSED.")
    pdf.bullet("Task status: NOT_STARTED, IN_PROGRESS, AWAITING_SIGNATURE, DONE_PENDING_REVIEW, APPROVED, BLOCKED.")
    pdf.bullet("Task responsible_role: DOCTOR, PT, ATP, REP, FRONT_DESK.")
    pdf.bullet("Payer types: dynamic via payer_types table (seeded: COMMERCIAL, MEDICAID, MEDICARE).")

    pdf.sub_title("Key business rules in the database")
    pdf.bullet("Tasks are snapshotted at patient creation - editing templates does not rewrite in-flight patients.")
    pdf.bullet("RLS policies control row visibility by role and patient assignment.")
    pdf.bullet("enforce_task_approval_gate trigger blocks unauthorized APPROVED transitions on ATP-gated tasks.")
    pdf.bullet("create_patient_with_tasks() RPC atomically creates patient + all template tasks.")
    pdf.bullet("update_app_user() RPC is the only way to change user profiles (direct table updates disabled).")
    pdf.bullet("on_auth_user_created trigger auto-creates app_users row (REP, inactive) on first OAuth sign-in.")

    pdf.section_title("7. Supabase Services on EC2")
    pdf.body("The Docker stack is trimmed for v1 - unnecessary Supabase services are disabled:")
    pdf.bullet("Enabled: db (Postgres 17), auth (GoTrue), rest (PostgREST), kong (API gateway), meta.")
    pdf.bullet("Disabled: storage, realtime, analytics, edge functions, imgproxy, pooler - v1 has no file uploads or push.")
    pdf.body(
        "Kong listens on port 8000 (public via security group). PostgREST exposes the public schema over REST. "
        "GoTrue handles OAuth and email/password sessions. Studio is disabled in production override."
    )

    pdf.section_title("8. Authentication Flow")
    pdf.body(
        "1. User visits any page -> proxy.ts checks Supabase session cookie.\n"
        "2. No session -> redirect to /login.\n"
        "3. Login via Microsoft OAuth or email/password -> Supabase GoTrue on EC2.\n"
        "4. OAuth callback at /auth/callback exchanges code for session cookie.\n"
        "5. First sign-in triggers handle_new_auth_user -> app_users row (REP, inactive).\n"
        "6. Admin activates user and assigns roles in /admin.\n"
        "7. All subsequent data access uses the anon key + user JWT; RLS enforces permissions."
    )

    pdf.section_title("9. Migration History")
    for m in [
        "0001_init.sql - Core tables, indexes, handle_new_auth_user trigger.",
        "0002_rls.sql - Security-definer helpers + RLS policies on all tables.",
        "0003_approve_gate.sql - ATP approval gate trigger + completion stamps.",
        "0004_supervising_atp.sql - supervising_atp_id on app_users.",
        "0005_harden_user_and_patient_workflows.sql - update_app_user RPC, create_patient_with_tasks RPC.",
        "0006_fix_create_patient_payer_type.sql - Payer type lookup fix in patient creation.",
        "0007_task_link_history.sql - task_link_events table + RLS.",
        "0008_requires_atp_review_default_true.sql - Default ATP review flag on templates.",
        "0009_payer_types_admin.sql - payer_types table; FK replaces hard-coded CHECK constraints.",
        "0010_ensure_builtin_payer_types.sql - Seed built-in payer type rows.",
        "0011_task_awaiting_signature_status.sql - AWAITING_SIGNATURE task status.",
    ]:
        pdf.bullet(m)

    pdf.section_title("10. Security & HIPAA Notes")
    pdf.bullet("v1 intentionally avoids document storage to sidestep HIPAA-tier Supabase Cloud costs.")
    pdf.bullet("Current EC2 stack uses synthetic seed data for validation - real PHI requires AWS BAA, backups, audit logging.")
    pdf.bullet("Postgres port 5432 is not exposed to the public internet; migrations run inside Docker on EC2.")
    pdf.bullet("Never commit .env.local, .env.aws.local, or PEM keys to git.")
    pdf.bullet("Disable email signup and dev password auth before production cutover with real patients.")
    pdf.bullet("Do not log patient names (PHI) - log patient IDs and external codes only.")

    pdf.section_title("11. Quick Reference - Common Operations")
    pdf.bullet("Apply DB migrations: infra/aws/scripts/apply-migrations-from-windows.ps1 or EC2 Instance Connect browser terminal.")
    pdf.bullet("Read EC2 keys: SSH to EC2, sudo grep ANON_KEY /opt/choice-supabase/.env")
    pdf.bullet("Update Amplify env: infra/aws/scripts/update-amplify-env.ps1")
    pdf.bullet("Local dev: npm run dev with .env.local pointing at EC2 (current setup) or supabase start for fully local.")
    pdf.bullet("Demo login (seed data): tara@choice.example / password123")

    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(100, 100, 100)
    pdf.multi_cell(
        0,
        5,
        "Sources: ARCHITECTURE.md, infra/aws/DEPLOYMENT.md, CLAUDE.md, supabase/migrations/, "
        ".env.example, and live inspection of this development workstation (June 2026).",
    )

    pdf.output(OUT)
    return OUT


if __name__ == "__main__":
    path = build()
    print(path)
