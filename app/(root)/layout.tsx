// Root layout of "/" only (the language chooser). The shop itself has its own root layout per language in
// app/[locale]/layout.tsx, and the back office has one in app/admin/layout.tsx: there is deliberately no
// app/layout.tsx, so that every static page carries the right <html lang dir>.
import "../globals.css";
import { THEME_BOOT } from "@/components/site/Theme";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" data-theme="light" suppressHydrationWarning>
      <head>
        {/* the saved theme first, so the moment before the redirect is drawn on the right ground */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
