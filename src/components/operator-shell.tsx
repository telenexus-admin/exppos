"use client";

import { useEffect, useState, type ReactNode } from "react";

const links = [
  ["Overview", "dashboard"],
  ["POS Clients", "tenants"],
  ["Onboard Business", "tenants/new"],
  ["Plans", "plans"],
  ["Subscriptions", "subscriptions"],
  ["Audit Activity", "audit-logs"],
  ["Platform Settings", "settings"],
] as const;

function MenuIcon({ close = false }: { close?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {close ? (
        <><path d="M5 5l14 14" /><path d="M19 5 5 19" /></>
      ) : (
        <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></>
      )}
    </svg>
  );
}

export function OperatorShell({
  title,
  current,
  children,
}: {
  title: string;
  current: string;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    const desktopQuery = window.matchMedia("(min-width: 821px)");
    const onDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false);
    };
    const previousOverflow = document.body.style.overflow;

    if (mobileOpen) document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onEscape);
    desktopQuery.addEventListener("change", onDesktop);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onEscape);
      desktopQuery.removeEventListener("change", onDesktop);
    };
  }, [mobileOpen]);

  return (
    <div className={`operator-portal${mobileOpen ? " operator-portal--mobile-open" : ""}`}>
      <aside id="operator-navigation">
        <div className="operator-sidebar-heading">
          <a className="operator-brand" href="/operator/dashboard" onClick={() => setMobileOpen(false)}>
            <span className="operator-mark">S</span>
            <div><strong>Speedyhive</strong><small>Operator Console</small></div>
          </a>
          <button className="operator-mobile-close" type="button" aria-label="Close operator menu" onClick={() => setMobileOpen(false)}>
            <MenuIcon close />
          </button>
        </div>

        <nav aria-label="Operator navigation">
          {links.map(([label, path]) => (
            <a
              key={path}
              className={current === path ? "active" : ""}
              href={`/operator/${path}`}
              onClick={() => setMobileOpen(false)}
            >
              <span>{label.slice(0, 1)}</span>{label}
            </a>
          ))}
        </nav>

        <div className="operator-user">
          <span>OP</span>
          <div><strong>Platform Operator</strong><small>System administrator</small></div>
          <a className="operator-logout" href="/api/v1/operator/logout">Log out</a>
        </div>
      </aside>

      <button
        className="operator-mobile-backdrop"
        type="button"
        aria-label="Close operator menu"
        tabIndex={mobileOpen ? 0 : -1}
        onClick={() => setMobileOpen(false)}
      />

      <main>
        <header>
          <div className="operator-title-row">
            <button
              className="operator-mobile-toggle"
              type="button"
              aria-controls="operator-navigation"
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? "Close operator menu" : "Open operator menu"}
              onClick={() => setMobileOpen((value) => !value)}
            >
              <MenuIcon close={mobileOpen} />
            </button>
            <div><small>PLATFORM OPERATIONS</small><h1>{title}</h1></div>
          </div>

          <div className="operator-actions">
            <a href="/operator/tenants/new" className="operator-primary">+ Onboard POS Client</a>
            <div className="operator-header-profile">
              <span>OP</span>
              <div><strong>Platform Operator</strong><small>Administrator</small></div>
              <a href="/api/v1/operator/logout">Log out</a>
            </div>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
