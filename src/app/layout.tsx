import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
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
import "./admin-otp.css";
import "./product-edit.css";
import "./operator-admin-login.css";
import "./tenant-operations.css";
import "./tenant-settings.css";
import "./account-controls.css";
import "./customer-management.css";
import "./report-analytics.css";
import "./expense-management.css";
import "./pwa-install.css";
import "./operator-access.css";
import "./mobile-app.css";
import "./report-calendar-product-image.css";
import "./desktop-portal-fix.css";
import { TenantAccountMount } from "@/components/tenant-account-mount";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: { default: "SHV POS", template: "%s | SHV POS" },
  applicationName: "SHV POS",
  description: "Speedyhive Cloud POS for sales, stock, staff and branch management.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/shv-pos-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/icons/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "SHV POS", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: "#0b2d22", width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}<PwaRegister /><TenantAccountMount /></body></html>;
}
