import type { ReactNode, SVGProps } from "react";

export type PortalIconName =
  | "dashboard"
  | "pos"
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
  | "audit-logs"
  | "settings"
  | "notifications"
  | "menu"
  | "chevrons-left"
  | "chevrons-right";

const paths: Record<PortalIconName, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  pos: <><path d="M4 5h16v13H4z"/><path d="M8 21h8M9 9h6M9 13h2"/></>,
  branches: <><circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v5M5 17v-2h14v2"/></>,
  staff: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></>,
  customers: <><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M16 3.5a4 4 0 0 1 0 7.5M19 14a6 6 0 0 1 3 5v2"/></>,
  products: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4.5 7.5 7.5 4 7.5-4M12 11.5V21"/></>,
  inventory: <><path d="M3 7h18M5 7l1 14h12l1-14M9 11v6M15 11v6M8 3h8l1 4H7z"/></>,
  purchases: <><circle cx="9" cy="20" r="1"/><circle cx="19" cy="20" r="1"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L21 8H7"/></>,
  sales: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/><path d="m15 5 3-3 3 3M18 2v8"/></>,
  invoices: <><path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>,
  accounting: <><path d="M4 4h16v16H4zM4 9h16M9 9v11"/><path d="M13 13h3M13 17h3"/></>,
  reports: <><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/></>,
  tasks: <><path d="M9 5h11M9 12h11M9 19h11"/><path d="m3 5 1 1 2-2M3 12l1 1 2-2M3 19l1 1 2-2"/></>,
  "audit-logs": <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M8 3H4v4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  "chevrons-left": <><path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/></>,
  "chevrons-right": <><path d="m13 17 5-5-5-5M6 17l5-5-5-5"/></>,
};

export function PortalIcon({ name, ...props }: { name: PortalIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
