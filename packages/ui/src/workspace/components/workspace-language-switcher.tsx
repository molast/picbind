import React from "react";
import { FiCheck, FiChevronDown, FiGlobe } from "react-icons/fi";
import { getWorkspaceLabels, type Lang } from "../../locales";

export function WorkspaceLanguageSwitcher({ lang, onChange }: { lang: Lang; onChange(lang: Lang): void }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const labels = getWorkspaceLabels(lang);

  React.useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return <div ref={rootRef} className="relative">
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      className={`flex h-9 items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold hover:bg-black/5 ${open ? "bg-black/5" : ""}`}
      title={labels.language}
      aria-label={labels.language}
      aria-haspopup="menu"
      aria-expanded={open}
    >
      <FiGlobe className="h-[17px] w-[17px]" aria-hidden="true" />
      <span>{lang === "zh" ? "中文" : "EN"}</span>
      <FiChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open ? <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-32 rounded-md border border-slate-200 bg-white p-1 text-slate-700 shadow-lg" role="menu">
      {(["en", "zh"] as const).map((option) => <button
        key={option}
        type="button"
        onClick={() => {
          onChange(option);
          setOpen(false);
        }}
        className={`flex h-9 w-full items-center justify-between rounded px-2.5 text-xs font-semibold hover:bg-slate-100 ${lang === option ? "bg-slate-100 text-[#2f65cf]" : ""}`}
        role="menuitemradio"
        aria-checked={lang === option}
      >
        <span>{option === "zh" ? labels.chinese : labels.english}</span>
        {lang === option ? <FiCheck className="h-3.5 w-3.5" aria-hidden="true" /> : null}
      </button>)}
    </div> : null}
  </div>;
}
