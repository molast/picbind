import React from "react";

export function WorkspaceAction({ icon, label, disabled, onClick }: { icon: React.ReactNode; label: string; disabled: boolean; onClick(): void }) {
  return <button type="button" onClick={onClick} disabled={disabled} title={label} className="flex min-h-[54px] min-w-0 flex-col items-center justify-center gap-1 rounded-md border border-[#dfe3e8] bg-white text-[10px] text-[#526078] hover:border-[#9bb8ec] hover:bg-[#f2f6fd] hover:text-[#2457bd] disabled:cursor-not-allowed disabled:opacity-35"><span className="text-[15px]">{icon}</span><span>{label}</span></button>;
}

export function ColorControl({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label className="grid gap-1.5 text-[11px] font-bold text-slate-500"><span>{label}</span><span className="flex h-9 items-center gap-2 rounded-md border bg-white px-2"><input type="color" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0" /><code className="text-[11px] font-normal uppercase text-slate-600">{value}</code></span></label>;
}
