import type { ReactNode } from "react";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./styles.css";
import "./portal.css";

export const metadata = { title: "Speedyhive Cloud POS", description: "Secure multi-tenant POS management" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
