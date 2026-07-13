"use client";

import { useEffect, useRef, useState } from "react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type Profile = {
  fullName: string;
  username: string;
  email: string;
  phone: string | null;
  tenantName: string;
  tenantCode: string;
  roles: string[];
};

function initials(value: string) {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "ME";
}

export function TenantProfileMenu({ fallbackRole }: { fallbackRole: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    authenticatedFetch("/api/v1/auth/me", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        if (active && body?.user) setProfile(body.user as Profile);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const name = profile?.fullName ?? fallbackRole;
  const role = profile?.roles.join(", ") || fallbackRole;

  return (
    <div className="tenant-profile-menu" ref={rootRef}>
      <button
        className="tenant-profile-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tenant-profile-avatar">{initials(name)}</span>
        <span className="tenant-profile-copy"><strong>{name}</strong><small>{role}</small></span>
        <span className="tenant-profile-chevron" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="tenant-profile-popover" role="menu">
          <div>
            <strong>{name}</strong>
            <small>{profile ? `@${profile.username} · ${profile.tenantName}` : role}</small>
            {profile?.email && <small>{profile.email}</small>}
            {profile?.phone && <small>{profile.phone}</small>}
          </div>
          <a className="tenant-profile-logout" href="/api/v1/auth/logout" role="menuitem">Log out securely</a>
        </div>
      )}
    </div>
  );
}
