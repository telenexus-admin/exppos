# Architecture

The repository was empty at inspection time, so there was no existing frontend, backend, database, ORM, authentication, API, routing, styling, migration, or table structure to preserve.

## Selected foundation

Next.js App Router provides the web UI and versioned HTTP API in one TypeScript codebase. PostgreSQL supplies transactional consistency and row-level locking; Prisma owns the schema and migrations. APIs are suitable for the responsive web client now and native mobile clients later.

Tenant ownership is explicit. Every tenant-owned aggregate carries `tenantId`; request context derives it only from a verified server-side session. Repository/service functions require a `TenantContext` and append its tenant and permitted branch predicates. Payload tenant IDs are ignored or rejected. Platform-operator access uses a separate principal type and route namespace.

Authorization is permission-based at service/API boundaries. Roles are collections of permissions, including tenant-defined roles; platform permissions are not available to tenant role administration. Frontend menu filtering is presentation only.

Authentication uses Argon2id hashes, short-lived signed access tokens, rotating refresh sessions stored as hashes, account/subscription status checks, forced password change, and auditable login events. PINs are separately hashed and are never valid for remote login.

Audit records are append-only in application code. Production database roles must deny UPDATE/DELETE on `audit_logs` and permit INSERT/SELECT only. Sensitive values are redacted before persistence.

## API conventions

- `/api/v1/operator/*` â€” platform operator context
- `/api/v1/app/*` â€” tenant admin and permission-bearing tenant users
- `/api/v1/staff/*` â€” role-shaped staff experiences backed by the same services
- JSON errors: `{ "error": { "code", "message", "requestId", "details?" } }`
- Mutation requests support idempotency keys where money or stock changes.

## Delivery phases

1. Tenant/auth/RBAC/branch/audit foundation.
2. Operator portal, plans, atomic onboarding, suspension.
3. Tenant dashboard, branches, staff, custom roles, customers.
4. Catalogue, inventory, suppliers, purchasing.
5. POS, shifts, carts, payments, receipts, terminal switching.
6. Quotes, invoices, receivables, returns, manager approvals.
7. Accounting, reports, loyalty, tasks, notifications.
8. UI polish, threat review, full acceptance suite, deployment.

Each phase is gated by migrations, lint/type checks, tests, and an explicit review of tenant/branch predicates.
