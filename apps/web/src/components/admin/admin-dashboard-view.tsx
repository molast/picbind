"use client";

import { formatAdminBytes, type AdminDashboardState } from "./admin-types";

type AdminDashboardViewProps = {
  state: AdminDashboardState;
  stateUrl: string;
  showCompressedCount: boolean;
  statusText: string;
  isSaving: boolean;
  isLoading: boolean;
  isMounted: boolean;
  onCompressedCountChange(value: boolean): void;
  onSave(): void | Promise<void>;
  onRefresh(): void | Promise<void>;
};

export default function AdminDashboardView({
  state,
  stateUrl,
  showCompressedCount,
  statusText,
  isSaving,
  isLoading,
  isMounted,
  onCompressedCountChange,
  onSave,
  onRefresh,
}: AdminDashboardViewProps) {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-800 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">
            PicBind Admin
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900">后台控制台</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            这里可以查看压缩统计、浏览次数，并控制首页数量组件的显示开关。
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          {[
            ["图片压缩总量", state.totalCompressed.toLocaleString()],
            ["网页浏览次数", state.totalViews.toLocaleString()],
            ["总节省容量", formatAdminBytes(state.totalSavedBytes)],
          ].map(([label, value]) => (
            <article
              key={label}
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="text-sm font-medium text-slate-500">{label}</div>
              <div className="mt-3 text-4xl font-bold text-slate-900">{value}</div>
            </article>
          ))}
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
                  <tr key={format} className="border-b border-slate-100 last:border-b-0">
                    <td className="py-4 pr-6 font-semibold uppercase text-slate-900">{format}</td>
                    <td className="py-4 pr-6 text-slate-700">
                      {state.formatStats[format].count.toLocaleString()}
                    </td>
                    <td className="py-4 text-slate-700">
                      {formatAdminBytes(state.formatStats[format].totalSavedBytes)}
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
            <ToggleRow
              title="显示累计压缩数量组件"
              detail="控制首页底部累计压缩数量卡片是否展示。"
              checked={showCompressedCount}
              onChange={onCompressedCountChange}
            />
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={isSaving || !stateUrl}
              className="rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "保存中..." : "保存配置"}
            </button>
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={isLoading || !stateUrl}
              className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "刷新中..." : "刷新数据"}
            </button>
            {statusText ? <span className="text-sm text-slate-500">{statusText}</span> : null}
          </div>
          <div className="mt-6 text-xs text-slate-400">
            最近更新时间：
            {isMounted
              ? new Date(state.updatedAt).toLocaleString("zh-CN", {
                  hour12: false,
                  timeZone: "Asia/Shanghai",
                })
              : "--"}
          </div>
        </section>
      </div>
    </main>
  );
}

function ToggleRow({
  title,
  detail,
  checked,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-4">
      <div>
        <div className="font-medium text-slate-900">{title}</div>
        <div className="mt-1 text-sm text-slate-500">{detail}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="h-5 w-5 accent-sky-600"
      />
    </label>
  );
}
