import type { Metadata, Viewport } from "next";
import "@fontsource-variable/heebo";
import "@fontsource-variable/frank-ruhl-libre";
import "./admin.css";

export const metadata: Metadata = {
  title: "שבטים · ניהול",
  robots: { index: false, follow: false, nocache: true },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#E9E5DC" };

// The back office is its own root layout (the storefront's root layouts live in their route groups), so it
// renders its own <html> and <body> and loads none of the storefront's global CSS. The app switches lang/dir
// itself in the browser when the owner chooses English.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="adm-root">{children}</body>
    </html>
  );
}
