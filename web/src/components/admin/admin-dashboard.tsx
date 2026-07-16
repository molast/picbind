"use client";

import AdminDashboardView from "./admin-dashboard-view";
import { useAdminDashboard } from "./use-admin-dashboard";

export default function AdminDashboard() {
  const admin = useAdminDashboard();
  return (
    <AdminDashboardView
      {...admin}
      onCompressedCountChange={admin.setShowCompressedCount}
      onCompareSectionChange={admin.setShowCompareSection}
      onSave={admin.saveConfig}
      onRefresh={admin.refreshState}
    />
  );
}
