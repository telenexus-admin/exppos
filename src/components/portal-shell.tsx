"use client";

import { useState, type ReactNode } from "react";

type IconName =
  | "dashboard"
  | "cart"
  | "branches"
  | "staff"
  | "customers"
  | "products"
  | "inventory"
  | "purchases"
  | "sales"
  | "invoices"
  | "accounting"
  | "reports"
  | "tasks"
  | "audit"
  | "settings"
  | "bell"
  | "menu"
  | "collapse";

type NavigationItem = {
  label: string;
  slug: string;
  href: string;
  icon: IconName;
};

const tenantSections: NavigationItem[] = [
  { label: "Dashboard", slug: "dashboard", href: "/app/dashboard", icon: "dashboard" },
  { label: "POS Checkout", slug: "pos", href: "/app/pos", icon: "cart" },
  { label: "Branches", slug: "branches", href: "/app/branches", icon: "branches" },
  { label: "Staff", slug: "staff", href: "/app/staff", icon: "staff" },
  { label: "Customers", slug: "customers", href: "/app/customers", icon: "customers" },
  { label: "Products", slug: "products", href: "/app/products", icon: "products" },
  { label: "Inventory", slug: "inventory", href: "/app/inventory", icon: "inventory" },
  { label: "Purchases", slug: "purchases", href: "/app/purchases", icon: "purchases" },
  { label: "Sales", slug: "sales", href: "/app/sales", icon: "sales" },
  { label: "Invoices", slug: "invoices", href: "/app/invoices", icon: "invoices" },
  { label: "Accounting", slug: "accounting", href: "/app/accounting", icon: "accounting" },
  { label: "Reports", slug: "reports", href: "/app/reports", icon: "reports" },
  { label: "Tasks", slug: "tasks", href: "/app/tasks", icon: "tasks" },
  { label: "Audit Logs", slug: "audit-logs", href: "/app/audit-logs", icon: "audit" },
  { label: "Settings", slug: "settings", href: "/app/settings", icon: "settings" },
];

const staffSections: NavigationItem[] = [
  { label: "My Dashboard", slug: "dashboard", href: "/staff/dashboard", icon: "dashboard" },
  { label: "POS Checkout", slug: "pos", href: "/app/pos", icon: "cart" },
];

function PortalIcon({ name }: { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const paths: Record<IconName, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    cart: <><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
    branches: <><path d="M12 3v6" /><path d="M5 21v-6h14v6" /><path d="M5 15V9h14v6" /><rect x="9" y="2" width="6" height="5" rx="1" /><rect x="2" y="19" width="6" height="3" rx="1" /><rect x="16" y="19" width="6" height="3" rx="1" /></>,
    staff: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    customers: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M17 11h5" /><path d="M19.5 8.5v5" /></>,
    products: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></>,
    inventory: <><path d="M4 7h16" /><path d="M5 7l1 14h12l1-14" /><path d="M9 11v6" /><path d="M15 11v6" /><path d="M8 3h8l1 4H7l1-4Z" /></>,
    purchases: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>,
    sales: <><path d="M3 3v18h18" /><path d="m7 16 4-5 3 3 5-7" /><path d="M16 7h3v3" /></>,
    invoices: <><path d="M6 2h9l5 5v15H6Z" /><path d="M14 2v6h6" /><path d="M9 13h8" /><path d="M9 17h6" /></>,
    accounting: <><rect x="3" y="2" width="18" height="20" rx="2" /><path d="M7 6h10" /><path d="M7 10h2" /><path d="M12 10h2" /><path d="M17 10h0" /><path d="M7 14h2" /><path d="M12 14h2" /><path d="M17 14h0" /><path d="M7 18h2" /><path d="M12 18h5" /></>,
    reports: <><path d="M4 19V9" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="M22 19V3" /><path d="M2 21h22" /></>,
    tasks: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="m8 9 2 2 4-4" /><path d="M8 15h8" /></>,
    audit: <><path d="M12 22a10 10 0 1 0-10-10" /><path d="M2 4v6h6" /><path d="M12 6v6l4 2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.36.24.72.6.6 1v4c.12.4-.24.76-.6 1Z" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    menu: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>,
    collapse: <><path d="M15 18l-6-6 6-6" /><path d="M21 4v16" /></>,
  };

  return <svg aria-hidden="true" viewBox="0 0 24 24" {...common}>{paths[name]}</svg>;
}

export function PortalShell({
  title,
  role,
  current = "dashboard",
  basePath = "/app",
  branchName = "Business workspace",
  children,
}: {
  title: string;
  role: string;
  current?: string;
  basePath?: string;
  branchName?: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const sections = basePath === "/staff" ? staffSections : tenantSections;

  return (
    <div className={`portal${collapsed ? " portal--collapsed" : ""}`}>
      <aside className="portal-sidebar">
        <div className="portal-sidebar-head">
          <a className="brand portal-brand" href={`${basePath}/dashboard`}>
            <span className="portal-brand-mark">SH</span>
            <span className="portal-brand-copy">Speedyhive<small>Cloud POS</small></span>
          </a>
          <button
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            className="portal-collapse-button"
            onClick={() => setCollapsed((value) => !value)}
            type="button"
          >
            <PortalIcon name="collapse" />
          </button>
        </div>

        <nav aria-label="Main navigation">
          {sections.map((item) => (
            <a className={current === item.slug ? "active" : ""} href={item.href} key={item.slug} title={collapsed ? item.label : undefined}>
              <span className="portal-nav-icon"><PortalIcon name={item.icon} /></span>
              <span className="portal-nav-label">{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="profile portal-profile">
          <span className="avatar">{role.slice(0, 2).toUpperCase()}</span>
          <div className="portal-profile-copy"><strong>{role}</strong><small>{branchName}</small></div>
        </div>
      </aside>

      <section className="workspace">
        <header>
          <div className="portal-title-row">
            <button
              aria-label={collapsed ? "Open navigation" : "Close navigation"}
              className="portal-mobile-toggle"
              onClick={() => setCollapsed((value) => !value)}
              type="button"
            >
              <PortalIcon name="menu" />
            </button>
            <div><small>{branchName}</small><h2>{title}</h2></div>
          </div>
          <div className="header-actions">
            <a className="notification-link portal-notification-link" href={`${basePath}/notifications`}><PortalIcon name="bell" /><span>Notifications</span></a>
            <a className="primary action-link" href="/app/pos">New sale</a>
          </div>
        </header>
        {children}
      </section>
    </div>
  );
}
