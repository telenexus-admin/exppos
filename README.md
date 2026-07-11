# Speedyhive Cloud POS

Secure multi-tenant POS and business-management platform for `speedyhiveenterprises.com`.

## Stack

- Next.js 15 App Router and React 19
- TypeScript (strict mode)
- PostgreSQL
- Prisma ORM and migrations
- Argon2id password/PIN hashing
- Signed short-lived access tokens and database-backed refresh sessions
- Vitest

See [docs/architecture.md](docs/architecture.md) for security boundaries and the phased implementation plan.

## Local setup

1. Copy `.env.example` to `.env` and set strong secrets.
2. Run `pnpm install`.
3. Run `pnpm db:generate` and `pnpm db:migrate`.
4. Run `pnpm typecheck` and `pnpm test`.
5. Run `pnpm dev`.

No production or test credentials are committed. Bootstrap the first platform operator through the deployment secret-management workflow.
