"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PortalIcon, type PortalIconName } from "@/components/portal-icons";

type MenuItem = { label: string; slug: string; href: string; icon: PortalIconName };

const adminSections: MenuItem[] = [
  { label: "Dashboard", slug: "dashboard", href: "/app/dashboard", icon: "dashboard" },
  { label: "POS Checkout", slug: "pos", href: "/app/pos", icon: "pos" },
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
  { label: "Audit Logs", slug: "audit-logs", href: "/app/audit-logs", icon: "audit-logs" },
  { label: "Settings", slug: "settings", href: "/app/settings", icon: "settings" },
];

const staffSections: MenuItem[] = [
  { label: "My Dashboard", slug: "dashboard", href: "/staff/dashboard", icon: "dashboard" },
  { label: "POS Checkout", slug: "pos", href: "/app/pos", icon: "pos" },
  { label: "Customers", slug: "customers", href: "/app/customers", icon: "customers" },
  { label: "Products", slug: "products", href: "/app/products", icon: "products" },
  { label: "Inventory", slug: "inventory", href: "/app/inventory", icon: "inventory" },
  { label: "My Sales", slug: "sales", href: "/app/sales", icon: "sales" },
  { label: "Tasks", slug: "tasks", href: "/app/tasks", icon: "tasks" },
];

export function PortalShell({
  title,
  role,
  current = "dashboard",
  basePath = "/app",
  location = "Business workspace",
  children,
}: {
  title: string;
  role: string;
  current?: string;
  basePath?: string;
  location?: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sections = basePath === "/staff" ? staffSections : adminSections;

  useEffect(() => {
    setCollapsed(window.localStorage.getItem("speedyhive-sidebar-collapsed") === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem("speedyhive-sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className={`portal portal-v2${collapsed ? " sidebar-collapsed" : ""}${mobileOpen ? " mobile-menu-open" : ""}`}>
      <aside className="portal-sidebar">
        <div className="sidebar-brand-row">
          <a className="brand" href={`${basePath}/dashboard`} aria-label="Speedyhive dashboard">
            <span className="brand-mark">S</span>
            <span className="brand-copy"><strong>Speedyhive</strong><small>Cloud POS</small></span>
          </a>
          <button className="sidebar-collapse" type="button" onClick={toggleCollapsed} aria-label={collapsed ? "Expand menu" : "Collapse menu"}>
            <PortalIcon name={collapsed ? "chevrons-right" : "chevrons-left"} />
          </button>
        </div>

        <nav aria-label="Main navigation">
          {sections.map((item) => (
            <a
              className={current === item.slug ? "active" : ""}
              href={item.href}
              key={item.slug}
              title={collapsed ? item.label : undefined}
              onClick={() => setMobileOpen(false)}
            >
              <PortalIcon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="profile">
          <span className="avatar">{role.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>
          <div><strong>{role}</strong><small>{location}</small></div>
        </div>
      </aside>

      <button className="sidebar-backdrop" type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} />

      <section className="workspace">
        <header className="workspace-header">
          <div className="workspace-title-row">
            <button className="mobile-menu-button" type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <PortalIcon name="menu" />
            </button>
            <div><small>{location}</small><h2>{title}</h2></div>
          </div>
          <div className="header-actions">
            <a className="notification-link icon-link" href={`${basePath}/notifications`} aria-label="Notifications"><PortalIcon name="notifications" /><span>Notifications</span></a>
            <a className="primary action-link" href="/app/pos"><PortalIcon name="pos" /><span>New sale</span></a>
          </div>
        </header>
        {children}
      </section>
    </div>
  );
}
