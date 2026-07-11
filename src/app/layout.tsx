import type { ReactNode } from "react";
import "./styles.css";

export const metadata = { title: "Speedyhive Cloud POS", description: "Secure multi-tenant POS management" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
