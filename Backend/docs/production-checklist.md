**Production Deployment Runbook**

This project is deployment-capable only after the production checks below pass against the real VPS environment.

**Required Files**

- `docker-compose.production.yml`: MongoDB, Redis, API, and frontend runtime.
- `Backend/.env.production.example`: copy to `Backend/.env.production` and replace every placeholder.
- `Frontend/.env.production.example`: frontend build-time API/socket defaults.
- `deploy/mongo/*.sh`: MongoDB keyfile, app user, and replica-set bootstrap scripts.
- `deploy/nginx/lms-portal.conf`: host NGINX TLS reverse proxy template.
- `deploy/pm2/ecosystem.config.cjs`: optional non-Docker PM2 process manager config.
- `deploy/systemd/lms-*-backup.*`, `lms-backup-verify.*`, `lms-backup-sync.*`, and `lms-restore-drill.*`: daily backup, verification, off-server sync, and monthly restore-drill timer templates.
- `Backend/scripts/backup/*.sh`: MongoDB backup, uploads backup, guarded restore, backup verification, off-server sync, and non-destructive restore drill scripts.
- `docker-compose.monitoring.yml` and `deploy/monitoring/**`: Prometheus, Alertmanager, Grafana, Loki, Promtail, node-exporter, and cAdvisor monitoring stack.

**First Deploy**

1. Copy `Backend/.env.production.example` to `Backend/.env.production`.
2. Replace `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MONGO_INITDB_ROOT_PASSWORD`, `MONGO_APP_PASSWORD`, `MONGO_REPLICA_SET_KEY`, `REDIS_PASSWORD`, and all domain placeholders.
3. Set `METRICS_TOKEN` to a strong random value or explicitly set `METRICS_ENABLED=false`.
4. Set `FRONTEND_ORIGIN` to the real HTTPS origin only.
5. Confirm `MONGODB_URI` uses `MONGO_APP_USERNAME`, not `MONGO_INITDB_ROOT_USERNAME`, and includes `replicaSet=rs0`.
6. Set `RESEND_API_KEY`, keep `RESEND_FROM_EMAIL=noreply@analyticsedify.com`, set `PASSWORD_RESET_DELIVERY_MODE=resend`, and confirm all password-reset frontend URLs use `https://lms.analyticsedify.com`; never enable `PASSWORD_RESET_RETURN_TOKEN` in production.
7. Keep `REDIS_MAXMEMORY_POLICY=noeviction`; tune `REDIS_MAXMEMORY` after the 500 and 1000 user load tests.
8. Create the initial SuperAdmin with `npm run create -- --name="Prionex Owner" --email="owner@prionex.com" --password="StrongPassword123!"`; do not store SuperAdmin credentials in environment files.
9. Run `npm run verify` and confirm at least one active SuperAdmin and no more than five total SuperAdmins.
10. Create the host backup directory from `HOST_BACKUP_ROOT` and restrict it to the deployment user.
11. Run `docker compose --env-file Backend/.env.production -f docker-compose.production.yml build`.
12. Run `docker compose --env-file Backend/.env.production -f docker-compose.production.yml up -d`.
13. Run migrations and indexes:
   - `docker compose --env-file Backend/.env.production -f docker-compose.production.yml exec api1 npm run db:migrate:refresh-token-hashes`
   - `docker compose --env-file Backend/.env.production -f docker-compose.production.yml exec api1 npm run db:migrate:violations`
   - `docker compose --env-file Backend/.env.production -f docker-compose.production.yml exec api1 npm run db:create-indexes`
14. Run `docker compose --env-file Backend/.env.production -f docker-compose.production.yml exec api1 npm run prod:check`.
15. Write the metrics token for Prometheus:
   - `mkdir -p deploy/monitoring/secrets`
   - `printf "%s" "$METRICS_TOKEN" > deploy/monitoring/secrets/metrics_token`
   - `chmod 600 deploy/monitoring/secrets/metrics_token`
16. Start monitoring after the production stack is healthy:
   - `docker compose --env-file Backend/.env.production -f docker-compose.monitoring.yml up -d`

`deploy/mongo/init-app-user.sh` runs only when MongoDB initializes an empty `mongo_data` volume. `mongo-init` then initiates the single-node replica set before the API starts. For an already-existing production MongoDB, create the least-privilege user and initiate/verify the replica set manually before switching `MONGODB_URI`.

**NGINX And SSL**

- Replace `lms.analyticsedify.com` in `deploy/nginx/lms-portal.conf`.
- Install the file in `/etc/nginx/sites-available/lms-portal`.
- Symlink it to `/etc/nginx/sites-enabled/lms-portal`.
- Issue certificates with Certbot and verify `nginx -t`.
- The Docker frontend listens on `127.0.0.1:8080`; public traffic should terminate at host NGINX.

**Backups**

- MongoDB backup: `Backend/scripts/backup/mongodb-backup.sh`
- Uploads backup: `Backend/scripts/backup/uploads-backup.sh`
- Full backup: `cd Backend && npm run backup:all`
- Verify latest backups: `cd Backend && npm run backup:verify`
- Sync verified backups off-server: `cd Backend && npm run backup:sync`
- Non-destructive restore drill: `cd Backend && npm run backup:restore-drill`
- Restore requires an explicit confirmation:
  `CONFIRM_RESTORE=YES RESTORE_ARCHIVE=/path/to/mongodb.archive.gz Backend/scripts/backup/mongodb-restore.sh`
- Upload restore also requires confirmation:
  `CONFIRM_RESTORE=YES RESTORE_UPLOADS_ARCHIVE=/path/to/uploads.tar.gz Backend/scripts/backup/uploads-restore.sh`

Configure either `BACKUP_RCLONE_DESTINATION` or `BACKUP_SYNC_COMMAND`; set `BACKUP_SYNC_CONFIGURED=true` when using a custom command that should not be exposed to the API container. `npm run prod:check` fails production mode when no off-server sync is declared. Install the systemd timers from `deploy/systemd` or schedule equivalent cron jobs, then verify the monthly restore drill succeeds before production traffic.

**Monitoring**

- Liveness: `GET /api/live`
- Readiness: `GET /api/ready`
- Human health: `GET /api/health`
- Prometheus scrape: `GET /api/metrics` with `Authorization: Bearer $METRICS_TOKEN`
- Super Admin health now reports upload disk usage, temporary upload backlog, malware-scan state, and backup freshness.
- Prometheus alerts cover API scrape failure, MongoDB, Redis, API error rate, upload disk usage, stale temp uploads, and missing/stale backups.
- `ALERTMANAGER_WEBHOOK_URL` must point to your production alert receiver before starting `docker-compose.monitoring.yml`.
- Grafana is bound to localhost by default; expose it only through authenticated NGINX/VPN access.

Every API response includes `X-Request-Id`; use it to correlate frontend errors, API logs, and reverse-proxy logs.

**Upload Operations**

- ClamAV is included in production Docker Compose and uploads are scanned when `UPLOAD_AV_SCAN_ENABLED=true`.
- Keep `UPLOAD_AV_SCAN_REQUIRED=true` for production; `npm run prod:check` fails if scanning is required but unavailable.
- Upload disk thresholds are controlled by `UPLOAD_DISK_WARNING_PERCENT` and `UPLOAD_DISK_CRITICAL_PERCENT`.
- Uploads are still permission-checked through the API; do not expose the upload volume directly through NGINX.

**Password Reset**

- Public reset endpoints exist for `/api/auth`, `/api/admin/auth`, `/api/college-admin/auth`, and `/api/super-admin/auth`.
- Forgot-password responses are generic to avoid account enumeration.
- Reset tokens are stored only as SHA-256 hashes, expire by TTL index, and revoke active refresh sessions after password reset.
- Production delivers reset links directly through Resend using `RESEND_API_KEY` and `RESEND_FROM_EMAIL=noreply@analyticsedify.com`; development may use `PASSWORD_RESET_DELIVERY_MODE=response` only for local testing.
- Configure portal-specific reset URLs when the frontend paths differ: `PASSWORD_RESET_FRONTEND_URL`, `PASSWORD_RESET_ADMIN_FRONTEND_URL`, `PASSWORD_RESET_COLLEGE_ADMIN_FRONTEND_URL`, and `PASSWORD_RESET_SUPER_ADMIN_FRONTEND_URL`.

**Pre-Launch Gate**

- Backend: `npm test`, `npm run lint -- --quiet`, `npm run prod:check`
- Frontend: `npm test`, `npm run lint -- --quiet`, `npm run build`
- Docker: `docker compose --env-file Backend/.env.production -f docker-compose.production.yml config`
- Monitoring Docker: `docker compose --env-file Backend/.env.production -f docker-compose.monitoring.yml config`
- Local Docker rehearsal before buying/renting infrastructure: `cd Backend && npm run smoke:local-production`
- Runtime: `/api/ready` returns healthy MongoDB and Redis statuses.
- Load: run `npm run load:exam-flow:100`, `npm run load:exam-flow:500`, and `npm run load:exam-flow:1000` from `Backend` against the deployed VPS using disposable students and an active disposable test.

`smoke:local-production` generates temporary strong secrets, chooses a local frontend port, starts the production Docker stack, runs required migrations and indexes, verifies `prod:check` and `/api/ready`, checks the frontend reverse proxy, then removes the disposable containers and volumes. It sets `ALLOW_LOCAL_PRODUCTION_SMOKE=true` only for this disposable run so loopback HTTP origins are allowed locally while real production checks still require HTTPS. Set `LOCAL_PROD_SMOKE_INCLUDE_FRONTEND=false` to test only API/MongoDB/Redis, or `LOCAL_PROD_SMOKE_KEEP_STACK=true` to leave the stack running for manual inspection.

**Still Required On The Real VPS**

- Run `npm run backup:all`, `npm run backup:verify`, `npm run backup:sync`, and `npm run backup:restore-drill` against real storage.
- Confirm Alertmanager delivers alerts to the real receiver.
- Load test on the actual VPS with Redis, MongoDB, ClamAV, and monitoring enabled.
- Keep a rollback procedure for schema/data migrations.
