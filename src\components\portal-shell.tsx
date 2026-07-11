import type { ReactNode } from "react";
const sections = ["Dashboard","POS Checkout","Branches","Staff","Customers","Products","Inventory","Purchases","Sales","Invoices","Accounting","Reports","Tasks","Audit Logs","Settings"];
export function PortalShell({ title, role, children }: { title: string; role: string; children: ReactNode }) {
  return <div className="portal"><aside><a className="brand" href="/app/dashboard">Speedyhive<span>Cloud POS</span></a><nav>{sections.map((item, i) => <a className={i === 0 ? "active" : ""} href="#" key={item}>{item}</a>)}</nav><div className="profile"><span className="avatar">SH</span><div><strong>{role}</strong><small>Head Office</small></div></div></aside><section className="workspace"><header><div><small>Business workspace</small><h2>{title}</h2></div><div className="header-actions"><button>Notifications</button><button className="primary">New sale</button></div></header>{children}</section></div>;
}
