import AdminApp from "@/components/admin/AdminApp";

// One prerendered shell; everything else happens in the browser (in-page navigation by URL hash).
export default function AdminPage() {
  return <AdminApp />;
}
