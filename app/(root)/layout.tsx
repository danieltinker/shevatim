// Root layout of "/" only (the language chooser). The shop itself has its own root layout per language in
// app/[locale]/layout.tsx, and the back office has one in app/admin/layout.tsx: there is deliberately no
// app/layout.tsx, so that every static page carries the right <html lang dir>.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ margin: 0, background: "#000", color: "#F3EFE7", fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
