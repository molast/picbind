import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import AdminDashboard from "@/components/admin-dashboard";
import { getAdminDashboardState } from "@/server/metrics-store";
import { isAdminConfigured, isAdminKeyValid } from "@/server/admin-auth";

type AdminPageProps = {
  searchParams?: {
    key?: string;
  };
};

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: AdminPageProps) {
  noStore();

  if (!isAdminConfigured()) {
    notFound();
  }

  const key = searchParams?.key || "";
  if (!isAdminKeyValid(key)) {
    notFound();
  }

  const state = await getAdminDashboardState();
  return <AdminDashboard adminKey={key} initialState={state} />;
}
