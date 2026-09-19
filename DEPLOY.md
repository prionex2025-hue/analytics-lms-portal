# LMS Portal — Production Deployment (Hostinger KVM 8 / Ubuntu)

End-to-end deploy for a **fresh Ubuntu VPS**. Matches the current repo: the API
runs as **3 replicas** (`api1` = worker + web, `api2`/`api3` = web-only), fronted
by an in-container NGINX, behind a host NGINX that terminates TLS.

> Target host: Hostinger **KVM 8** (8 vCPU, 32 GB RAM, 400 GB NVMe) — comfortably
> sized for ~1500 students. Resource limits in `docker-compose.production.yml`
> are tuned for this box.

## Architecture

```
Internet ──443/TLS──▶ host NGINX ──▶ frontend container :8080 ──▶ api1/api2/api3 :5000
                     (certbot)        (React + reverse proxy)      │
                                                                    ├─▶ mongo  (replica set rs0)
                                                                    ├─▶ redis  (rate limits, queues, socket adapter)
                                                                    └─▶ clamav (upload scanning)
```

Everything except the host NGINX runs in Docker. The frontend is built
same-origin (`VITE_API_BASE_URL=/api`), so **no frontend env file is needed**.

## Before you touch the server

1. **Confirm the latest code is on GitHub.** The VPS pulls from `origin/main`.
   ```bash
   # from your workstation
   git push origin main
   ```
2. **DNS** — in Hostinger's DNS panel, point your domain at the VPS IPv4:
   ```
   A   @     YOUR_VPS_IPV4
   A   lms   YOUR_VPS_IPV4
   ```
   Wait until it resolves: `ping lms.yourdomain.com`.
3. **Domain in code.** The repo hardcodes `lms.analyticsedify.com`. If that is
   *not* your domain, you will replace it in Step 5 **before building**.
4. **Resend** — add and DNS-verify your sending domain in the Resend dashboard,
   or password-reset emails will silently fail.

---

## Step 1 — Server prep (as `root`)

```bash
ssh root@YOUR_VPS_IP
apt update && apt -y upgrade
apt install -y git curl ufw nginx certbot python3-certbot-nginx
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version && docker compose version
```

## Step 2 — Deployment user

```bash
adduser deploy
usermod -aG sudo,docker deploy
su - deploy
```

Everything below runs as **`deploy`**.

## Step 3 — Clone the repo

```bash
sudo mkdir -p /var/www && sudo chown deploy:deploy /var/www
cd /var/www
git clone https://github.com/crazy-sam-02/Analytics-LMS-PORTAL.git lms-portal
cd lms-portal
```

(Private repo? Add a deploy key or use a token before cloning.)

## Step 4 — Backup directory

```bash
sudo mkdir -p /var/backups/lms-portal
sudo chown -R deploy:deploy /var/backups/lms-portal
chmod 700 /var/backups/lms-portal
```

## Step 5 — Replace the domain (skip if you use `lms.analyticsedify.com`)

The domain is baked into NGINX **and** the frontend Content-Security-Policy
(`connect-src ... wss://...`). It must be changed **before the build**, or
websockets/live-monitoring break in the browser.

```bash
# see every occurrence
grep -Rn "lms.analyticsedify.com" \
  deploy/nginx/lms-portal.conf Frontend/nginx.conf .github/workflows/deploy-vps.yml

# replace in the files that ship in images / configs
sed -i 's/lms\.analyticsedify\.com/lms.yourdomain.com/g' \
  deploy/nginx/lms-portal.conf Frontend/nginx.conf .github/workflows/deploy-vps.yml
```

## Step 6 — Production environment file

```bash
cp Backend/.env.production.example Backend/.env.production
```

Generate strong secrets:

```bash
echo "JWT_ACCESS_SECRET=$(openssl rand -base64 48)"
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 48)"
echo "MONGO_INITDB_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')"
echo "MONGO_APP_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')"
echo "REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')"
echo "METRICS_TOKEN=$(openssl rand -base64 32 | tr -d '/+=')"
echo "MONGO_REPLICA_SET_KEY=$(openssl rand -base64 96 | tr -d '\n')"
```

Now `nano Backend/.env.production` and set:

| Variable | Value |
|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | the generated values (≥32 chars) |
| `MONGO_INITDB_ROOT_PASSWORD`, `MONGO_APP_PASSWORD`, `REDIS_PASSWORD`, `MONGO_REPLICA_SET_KEY` | generated values |
| `MONGODB_URI` | put the **app** password in it, keep `authSource=lms_portal&replicaSet=rs0` (see below) |
| `METRICS_TOKEN` | generated value (or set `METRICS_ENABLED=false`) |
| `RESEND_API_KEY` | your real key (**required** — stack won't start without it) |
| `RESEND_FROM_EMAIL` | `noreply@yourdomain.com` (domain verified in Resend) |
| `FRONTEND_ORIGIN` | `https://lms.yourdomain.com` |
| `PASSWORD_RESET_FRONTEND_BASE_URL` and all `PASSWORD_RESET_*_URL` | `https://lms.yourdomain.com/...` |
| `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | your Cloudinary credentials |
| **Off-server backup** (required by `prod:check`) | set `BACKUP_RCLONE_DESTINATION=...` **or** `BACKUP_SYNC_COMMAND=...` + `BACKUP_SYNC_CONFIGURED=true` |

`MONGODB_URI` must use the **app** user + replica set:

```
MONGODB_URI=mongodb://lms_app:YOUR_MONGO_APP_PASSWORD@mongo:27017/lms_portal?authSource=lms_portal&replicaSet=rs0
```

> `prod:check` (Step 8) hard-fails if `METRICS_TOKEN` is unset (and metrics
> enabled) or if no off-server backup is configured. Set these now.

## Step 7 — Build and start the stack

```bash
docker compose --env-file Backend/.env.production -f docker-compose.production.yml build
docker compose --env-file Backend/.env.production -f docker-compose.production.yml up -d
```

Wait ~40s for Mongo replica-set init, then confirm all services are healthy:

```bash
docker compose --env-file Backend/.env.production -f docker-compose.production.yml ps
curl http://127.0.0.1:8080/api/ready     # expect {"status":"ok",...}
```

## Step 8 — Migrations, indexes, readiness gate

Run against **`api1`** (the worker replica):

```bash
CF="--env-file Backend/.env.production -f docker-compose.production.yml"
docker compose $CF exec api1 npm run db:migrate:refresh-token-hashes
docker compose $CF exec api1 npm run db:migrate:violations
docker compose $CF exec api1 npm run db:create-indexes
docker compose $CF exec api1 npm run prod:check     # MUST print "Readiness check passed."
```

## Step 9 — Create the first SuperAdmin

```bash
docker compose $CF exec api1 npm run create -- \
  --name="Mohan" --email="moonsara2209@gmail.com" --password="Sara@0609"
docker compose $CF exec api1 npm run verify
```

## Step 10 — TLS certificate (get it BEFORE installing the app NGINX config)

The repo's `lms-portal.conf` references cert files that don't exist yet, so it
can't pass `nginx -t` until the cert exists. Obtain it first, while the default
NGINX site is still in place:

```bash
sudo certbot certonly --nginx -d lms.analyticsedify.com
```

## Step 11 — Host NGINX reverse proxy

```bash
sudo cp deploy/nginx/lms-portal.conf /etc/nginx/sites-available/lms-portal
# confirm server_name AND the ssl_certificate paths point at lms.yourdomain.com
sudo nano /etc/nginx/sites-available/lms-portal
sudo ln -s /etc/nginx/sites-available/lms-portal /etc/nginx/sites-enabled/lms-portal
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## Step 12 — Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status
```

Do **not** expose MongoDB, Redis, ClamAV, or the API port publicly — they are
internal to the Docker network and the frontend binds only to `127.0.0.1:8080`.

## Step 13 — Verify it's live

```bash
curl -fsS https://lms.yourdomain.com/api/ready
```

Open `https://lms.yourdomain.com` and log in with the SuperAdmin account.

---

## Step 14 — Automated backups (do before real traffic)

Run one full cycle **on the host** (not inside a container — the script calls
`docker compose exec mongo mongodump`):

```bash
cd /var/www/lms-portal/Backend
npm run backup:all && npm run backup:verify
```

Then install the systemd timers for daily backup + verify + off-server sync +
monthly restore drill:

```bash
cd /var/www/lms-portal
sudo cp deploy/systemd/lms-*.service deploy/systemd/lms-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now \
  lms-mongodb-backup.timer lms-uploads-backup.timer \
  lms-backup-verify.timer lms-backup-sync.timer lms-restore-drill.timer
```

(Adjust `WorkingDirectory`/`User` in the unit files if your paths differ.)

## Step 15 — Monitoring (optional but recommended)

```bash
cd /var/www/lms-portal
mkdir -p deploy/monitoring/secrets
printf "%s" "$(grep '^METRICS_TOKEN=' Backend/.env.production | cut -d= -f2-)" \
  > deploy/monitoring/secrets/metrics_token
chmod 600 deploy/monitoring/secrets/metrics_token
# set ALERTMANAGER_WEBHOOK_URL in Backend/.env.production first
docker compose --env-file Backend/.env.production -f docker-compose.monitoring.yml up -d
```

Prometheus scrapes `api1/api2/api3`. Keep Grafana behind localhost/VPN only.

## Step 16 — One-click redeploys via GitHub Actions (optional)

`.github/workflows/deploy-vps.yml` is ready. Add these repo **Secrets**:

| Secret | Value |
|---|---|
| `VPS_HOST` | your VPS IP / hostname |
| `VPS_USER` | `deploy` |
| `VPS_PATH` | `/var/www/lms-portal` |
| `VPS_SSH_KEY` | a private key whose public half is in `~deploy/.ssh/authorized_keys` |

Then: GitHub → **Actions → Deploy VPS → Run workflow**. It pulls `origin/main`,
rebuilds, migrates, runs `prod:check`, and curls `/api/ready`.

---

## Pre-launch gate (before opening to 1500 students)

Validate the 3-replica config under load on the live box:

```bash
cd /var/www/lms-portal/Backend && npm run load:exam-flow:1000
```

Watch p95 latency and error rate. Clean run → go.

## Everyday operations

```bash
CF="--env-file Backend/.env.production -f docker-compose.production.yml"

# logs (per replica)
docker compose $CF logs -f api1
docker compose $CF logs -f frontend

# restart everything
docker compose $CF restart

# manual redeploy
git pull
docker compose $CF build
docker compose $CF up -d
```

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `no such service: api` | Use **`api1`** (3-replica layout), not `api`. |
| `prod:check` fails | `METRICS_TOKEN` unset **or** no off-server backup configured. |
| `nginx -t` fails on cert path | Run `certbot certonly` (Step 10) **before** installing the config. |
| Websockets fail / CSP errors in console | Domain not replaced in `Frontend/nginx.conf` **before** build (Step 5). Rebuild frontend. |
| Whole API returns `503` | Redis is down (rate limiting fails closed). `docker compose $CF logs redis`. |
| Reset emails not sent | Resend sending domain not verified, or `RESEND_API_KEY` wrong. |
| Report returns `422 query too broad` | Raise `DB_RELATION_FILTER_MAX_CANDIDATES` or add filters. |

## Notes / known single points of failure

- **Redis** and **Mongo** are single-node. Redis down ⇒ API `503` until it
  recovers (auto-restart + AOF persistence make this brief). Mongo is a
  single-member replica set; backups + restore drills cover data loss, not
  instant availability. Both are monitored by the Prometheus alerts.
- The API's queue workers (report PDFs, student import) run only on **api1**.
  If you ever scale replica count, keep exactly one worker replica.
