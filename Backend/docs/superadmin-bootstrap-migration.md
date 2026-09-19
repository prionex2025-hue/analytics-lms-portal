# SuperAdmin Bootstrap Migration

SuperAdmin credentials are no longer read from environment variables. Every SuperAdmin account must exist in MongoDB and authenticate through the JWT login flow.

## One-Time Bootstrap

From `Backend/`:

```bash
npm run create -- --name="Analytics CEO" --email="admin@prionex.dev" --password="Prionex@2025!"
```

The script enforces:

- Valid email format
- Password policy: uppercase, lowercase, number, special character, and 8 or more characters
- Maximum of 5 SuperAdmin accounts

## Password Reset

From `Backend/`:

```bash
npm run reset -- --email="admin@prionex.dev"
```

The script generates a temporary password, hashes it, updates the MongoDB account, revokes active sessions, writes an audit record, and prints the temporary password once.

## Verification

From `Backend/`:

```bash
npm run verify
```

Expected invariant:

- Total SuperAdmins must be less than or equal to 5
- Active SuperAdmins must be at least 1

## Environment Cleanup

Delete these variables from `.env`, `.env.production`, Docker Compose env files, and deployment secret stores:

- `SUPERADMIN_EMAIL`
- `SUPERADMIN_PASSWORD`
- `SUPERADMIN_NAME`
- `SUPER_ADMIN_EMAIL`
- `SUPER_ADMIN_PASSWORD`

Do not add replacement credential variables. Use `npm run create` for bootstrap and the SuperAdmin panel's System Administrators page for ongoing management.
