import { notFound } from "next/navigation";
import { OperatorShell } from "@/components/operator-shell";
import { OperatorActionButton } from "@/components/operator-action-button";
import { DeleteTenantButton } from "@/components/delete-tenant-button";
import { prisma } from "@/lib/prisma";

const statusLabel = (status: string) => status.toLowerCase().split("_").map(x => x[0].toUpperCase() + x.slice(1)).join(" ");

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ created?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const tenant = await prisma.tenant.findFirst({
    where: { slug, status: { not: "CANCELLED" } },
    include: {
      subscription: { include: { plan: true } },
      branches: { where: { isHeadOffice: true }, take: 1 },
      auditLogs: { orderBy: { createdAt: "desc" }, take: 4 },
      _count: { select: { branches: true, users: true } },
      sales: { select: { total: true }, where: { createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } },
    },
  });
  if (!tenant) notFound();

  const label = statusLabel(tenant.status);
  const sales = tenant.sales.reduce((sum, sale) => sum + Number(sale.total), 0);
  const headOffice = tenant.branches[0];

  return <OperatorShell title={tenant.name} current="tenants">
    {query.created && <div className="operator-notice">✓ POS client created successfully and saved in PostgreSQL.</div>}
    <div className="tenant-hero">
      <span className="tenant-logo large">{tenant.name.split(" ").map(x => x[0]).slice(0,2)}</span>
      <div><p>{tenant.code} · {tenant.slug}</p><h2>{tenant.name}</h2><span className={`tenant-status ${label.toLowerCase().replace(" ", "-")}`}>{label}</span></div>
      <div className="tenant-controls">
        <OperatorActionButton label="Reset admin password" success="Password reset request prepared"/>
        <OperatorActionButton label="Extend subscription" success="Subscription extended by 30 days"/>
        <OperatorActionButton label={tenant.status === "SUSPENDED" ? "Reactivate tenant" : "Suspend tenant"} success={tenant.status === "SUSPENDED" ? "Tenant reactivated" : "Tenant suspended"} danger={tenant.status !== "SUSPENDED"}/>
        <DeleteTenantButton tenantId={tenant.id} tenantName={tenant.name}/>
      </div>
    </div>
    <div className="operator-metrics tenant-metrics">
      {[
        ["Plan", tenant.subscription?.plan.name ?? "No plan", "Expires " + (tenant.subscription?.expiresAt?.toLocaleDateString("en-KE") ?? tenant.subscription?.trialEndsAt?.toLocaleDateString("en-KE") ?? "not set")],
        ["Branches", String(tenant._count.branches), "Plan usage"],
        ["Staff users", String(tenant._count.users), "Active accounts"],
        ["Sales volume", `KES ${sales.toLocaleString()}`, "Current month"],
      ].map(([a,b,c]) => <article key={a}><small>{a}</small><strong>{b}</strong><span>{c}</span></article>)}
    </div>
    <div className="operator-grid">
      <article className="operator-card wide"><div className="operator-card-head"><div><small>CLIENT PROFILE</small><h2>Business details</h2></div><a className="manage-link" href={`/operator/tenants/${tenant.slug}/edit`}>Edit client →</a></div><dl className="client-details"><div><dt>Business email</dt><dd>{tenant.email}</dd></div><div><dt>Primary phone</dt><dd>{tenant.phone}</dd></div><div><dt>Head office</dt><dd>{headOffice ? [headOffice.town, headOffice.address].filter(Boolean).join(", ") : "Not configured"}</dd></div><div><dt>Currency / timezone</dt><dd>{tenant.currency} · {tenant.timezone}</dd></div></dl></article>
      <article className="operator-card"><div className="operator-card-head"><div><small>RECENT ACTIVITY</small><h2>Audit events</h2></div><a className="manage-link" href="/operator/audit-logs">View all</a></div>{tenant.auditLogs.map(event => <div className="activity-item" key={event.id}><i/><div><strong>{event.action.toLowerCase().replaceAll("_", " ")}</strong><small>{event.createdAt.toLocaleString("en-KE")}</small></div></div>)}{tenant.auditLogs.length === 0 && <div className="operator-empty">No audit activity yet.</div>}</article>
    </div>
  </OperatorShell>;
}
