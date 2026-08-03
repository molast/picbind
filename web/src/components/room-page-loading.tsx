export default function RoomPageLoading() {
  return (
    <main
      className="h-screen overflow-hidden bg-[#eef2f7] text-slate-800"
      role="status"
      aria-label="Loading room"
    >
      <div className="grid h-full grid-rows-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_clamp(320px,24vw,420px)] lg:grid-rows-1">
        <section className="flex min-h-0 min-w-0 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
            <div className="h-6 w-28 animate-pulse rounded bg-slate-200" />
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 animate-pulse rounded bg-slate-200" />
              <div className="h-8 w-8 animate-pulse rounded bg-slate-200" />
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="mb-4 flex h-9 shrink-0 items-center gap-2">
              <div className="h-8 w-8 animate-pulse rounded bg-slate-200" />
              <div className="h-8 w-8 animate-pulse rounded bg-slate-200" />
              <div className="h-8 w-8 animate-pulse rounded bg-slate-200" />
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <div
                  key={index}
                  className="min-h-0 animate-pulse rounded-md border border-slate-200 bg-white"
                />
              ))}
            </div>
          </div>
        </section>
        <aside className="flex min-h-0 flex-col border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 px-4">
            <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-slate-300" />
            <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <div className="h-16 animate-pulse rounded-md bg-slate-100" />
            <div className="h-12 animate-pulse rounded-md bg-slate-100" />
            <div className="h-12 animate-pulse rounded-md bg-slate-100" />
          </div>
          <div className="h-14 shrink-0 border-t border-slate-200 p-3">
            <div className="h-full animate-pulse rounded bg-slate-100" />
          </div>
        </aside>
      </div>
      <span className="sr-only">Loading room</span>
    </main>
  );
}
