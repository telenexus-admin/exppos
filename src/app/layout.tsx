import type { ReactNode } from "react";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./styles.css";
import "./portal-enhancements.css";
import "./portal-overrides.css";
import "./pos-live.css";
import "./catalog-management.css";
import "./catalog-actions.css";
import "./login-flow.css";
import "./product-edit.css";
import "./operator-admin-login.css";
import "./tenant-operations.css";
import "./tenant-settings.css";
import "./account-controls.css";
import { TenantAccountMount } from "@/components/tenant-account-mount";

export const metadata = { title: "Speedyhive Cloud POS", description: "Secure multi-tenant POS management" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}<TenantAccountMount /></body></html>;
}
