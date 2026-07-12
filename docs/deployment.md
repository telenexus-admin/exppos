# Production deployment

## Required services

- Node.js 20+
- PostgreSQL 16+
- TLS-terminating reverse proxy or managed application platform
- Object storage and malware scanning for future logo/product uploads
- Transactional email provider for password resets and security alerts

## Release procedure

1. Supply the variables in `.env.example` through a secret manager.
2. Run `pnpm install --frozen-lockfile` and `pnpm db:generate`.
3. Back up PostgreSQL, then run `pnpm db:deploy` with a migration-only database role.
4. Run `pnpm typecheck`, `pnpm test`, and `pnpm build`.
5. Deploy immutable build artifacts with `NODE_ENV=production`.
6. Restrict the application DB role from UPDATE/DELETE on `AuditLog`.
7. Configure HTTPS, HSTS, database encryption/backups, log redaction, alerting, and rate limits at the edge.

Never commit live credentials or bootstrap operator passwords. Create the first operator through a one-time, audited deployment command and immediately enable MFA.
