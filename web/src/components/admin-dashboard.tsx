"use client";

import React from "react";

type AdminDashboardState = {
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

type AdminDashboardProps = {
  adminKey: string;
  initialState: AdminDashboardState;
};

function formatBytes(size: number) {
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

export default function AdminDashboard({
  adminKey,
  initialState,
}: AdminDashboardProps) {
  const [state, setState] = React.useState(initialState);
  const [showCompressedCount, setShowCompressedCount] = React.useState(
    initialState.showCompressedCount,
  );
  const [showCompareSection, setShowCompareSection] = React.useState(
    initialState.showCompareSection,
  );
  const [statusText, setStatusText] = React.useState<string>("");
  const [isSaving, setIsSaving] = React.useState(false);

  const adminStateApiPath = process.env.NEXT_PUBLIC_ADMIN_STATE_API_PATH || "";
  const stateUrl = React.useMemo(
    () =>
      adminStateApiPath
        ? `${adminStateApiPath}?key=${encodeURIComponent(adminKey)}`
        : "",
    [adminKey, adminStateApiPath],
  );

  const refreshState = React.useCallback(async () => {
    if (!stateUrl) {
      throw new Error("Admin state API is not configured");
    }
    const response = await fetch(stateUrl, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Failed to refresh admin state: ${response.status}`);
    }
    const next = (await response.json()) as AdminDashboardState;
    setState(next);
    setShowCompressedCount(next.showCompressedCount);
    setShowCompareSection(next.showCompareSection);
  }, [stateUrl]);

  const saveConfig = React.useCallback(async () => {
    setIsSaving(true);
    setStatusText("");
    try {
      if (!stateUrl) {
        throw new Error("Admin state API is not configured");
      }
      const response = await fetch(stateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          showCompressedCount,
          showCompareSection,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save admin config: ${response.status}`);
      }

      const next = (await response.json()) as AdminDashboardState;
      setState(next);
      setStatusText("已保存");
    } catch (error) {
      setStatusText(
        error instanceof Error ? error.message : "保存失败，请稍后重试",
      );
    } finally {
      setIsSaving(false);
    }
  }, [showCompareSection, showCompressedCount, stateUrl]);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-800 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">
            PicBind Admin
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900">
            后台控制台
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            这里可以查看压缩统计、浏览次数，并控制首页数量组件和压缩对比组件的显示开关。
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-slate-500">图片压缩总量</div>
            <div className="mt-3 text-4xl font-bold text-slate-900">
              {state.totalCompressed.toLocaleString()}
            </div>
          </article>
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-slate-500">网页浏览次数</div>
            <div className="mt-3 text-4xl font-bold text-slate-900">
              {state.totalViews.toLocaleString()}
            </div>
          </article>
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-slate-500">总节省容量</div>
            <div className="mt-3 text-4xl font-bold text-slate-900">
              {formatBytes(state.totalSavedBytes)}
            </div>
          </article>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">格式统计</h2>
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="pb-3 pr-6 font-medium">格式</th>
                  <th className="pb-3 pr-6 font-medium">压缩张数</th>
                  <th className="pb-3 font-medium">累计节省容量</th>
                </tr>
              </thead>
              <tbody>
                {(["jpeg", "png", "webp", "avif"] as const).map((format) => (
                  <tr
                    key={format}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    <td className="py-4 pr-6 font-semibold uppercase text-slate-900">
                      {format}
                    </td>
                    <td className="py-4 pr-6 text-slate-700">
                      {state.formatStats[format].count.toLocaleString()}
                    </td>
                    <td className="py-4 text-slate-700">
                      {formatBytes(state.formatStats[format].totalSavedBytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">前端展示开关</h2>
          <div className="mt-6 space-y-4">
            <label className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-4">
              <div>
                <div className="font-medium text-slate-900">显示累计压缩数量组件</div>
                <div className="mt-1 text-sm text-slate-500">
                  控制首页底部累计压缩数量卡片是否展示。
                </div>
              </div>
              <input
                type="checkbox"
                checked={showCompressedCount}
                onChange={(event) =>
                  setShowCompressedCount(event.currentTarget.checked)
                }
                className="h-5 w-5 accent-sky-600"
              />
            </label>

            <label className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-4">
              <div>
                <div className="font-medium text-slate-900">显示压缩对比组件</div>
                <div className="mt-1 text-sm text-slate-500">
                  控制首页图片前后对比滑块是否展示。
                </div>
              </div>
              <input
                type="checkbox"
                checked={showCompareSection}
                onChange={(event) =>
                  setShowCompareSection(event.currentTarget.checked)
                }
                className="h-5 w-5 accent-sky-600"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void saveConfig()}
              disabled={isSaving}
              className="rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "保存中..." : "保存配置"}
            </button>
            <button
              type="button"
              onClick={() => void refreshState()}
              className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              刷新数据
            </button>
            {statusText ? (
              <span className="text-sm text-slate-500">{statusText}</span>
            ) : null}
          </div>

          <div className="mt-6 text-xs text-slate-400">
            最近更新时间：{new Date(state.updatedAt).toLocaleString("zh-CN")}
          </div>
        </section>
      </div>
    </main>
  );
}
