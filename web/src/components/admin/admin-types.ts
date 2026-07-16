export type AdminDashboardState = {
  totalCompressed: number;
  totalViews: number;
  totalSavedBytes: number;
  formatStats: Record<
    "jpeg" | "png" | "webp" | "avif",
    { count: number; totalSavedBytes: number }
  >;
  showCompressedCount: boolean;
  showCompareSection: boolean;
  updatedAt: string;
};

export const EMPTY_ADMIN_STATE: AdminDashboardState = {
  totalCompressed: 0,
  totalViews: 0,
  totalSavedBytes: 0,
  formatStats: {
    jpeg: { count: 0, totalSavedBytes: 0 },
    png: { count: 0, totalSavedBytes: 0 },
    webp: { count: 0, totalSavedBytes: 0 },
    avif: { count: 0, totalSavedBytes: 0 },
  },
  showCompressedCount: true,
  showCompareSection: true,
  updatedAt: new Date(0).toISOString(),
};

export function formatAdminBytes(size: number) {
  const absolute = Math.abs(size);
  const prefix = size >= 0 ? "" : "-";
  if (absolute >= 1024 * 1024) {
    return `${prefix}${(absolute / 1024 / 1024).toFixed(2)} MB`;
  }
  if (absolute >= 1024) {
    return `${prefix}${(absolute / 1024).toFixed(1)} KB`;
  }
  return `${prefix}${absolute} B`;
}
