import type { Metadata } from "next";

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

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-800 sm:px-6">
      <section className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">
          PicBind Admin
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-900">
          后台接口已迁移
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          当前 Cloudflare Pages 版本暂不直接调用站内 API。后台统计与配置接口将由独立
          Cloudflare Worker 承接，接好 Worker 地址后再恢复这里的联动。
        </p>
      </section>
    </main>
  );
}
