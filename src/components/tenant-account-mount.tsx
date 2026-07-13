"use client";

import { usePathname } from "next/navigation";
import { TenantProfileMenu } from "@/components/tenant-profile-menu";

export function TenantAccountMount() {
  const pathname = usePathname();
  if (!pathname.startsWith("/app/") && !pathname.startsWith("/staff/")) return null;

  return (
    <div className="tenant-account-mount">
      <TenantProfileMenu fallbackRole="My account" />
    </div>
  );
}
