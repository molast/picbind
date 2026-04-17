import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import AdminDashboard from "@/components/admin-dashboard";
import { getAdminDashboardState } from "@/server/metrics-store";
import { isAdminConfigured, isAdminKeyValid } from "@/server/admin-auth";

type AdminPageProps = {
  searchParams?: Promise<{
    key?: string;
  }>;
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Admin",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  noStore();

  if (!isAdminConfigured()) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;
  const key = resolvedSearchParams?.key || "";
  if (!isAdminKeyValid(key)) {
    notFound();
  }

  const state = await getAdminDashboardState();
  return <AdminDashboard adminKey={key} initialState={state} />;
}
