"use client";

import Image from "next/image";
import Link from "next/link";
import { FiFolder, FiGrid, FiImage } from "react-icons/fi";
import { WorkspaceLanguageSwitcher } from "@picbind/ui/source";
import AccountControl from "@/components/auth/account-control";
import { getHomeCompressLandingCopy, type Lang } from "@/locales";

type DesktopAppHeaderProps = {
  lang: Lang;
  active: "compress" | "favicon";
  onLanguageChange(nextLang: Lang): void;
};

export default function DesktopAppHeader({
  lang,
  active,
  onLanguageChange,
}: DesktopAppHeaderProps) {
  const nav = getHomeCompressLandingCopy(lang).desktop;
  const activeClass = "bg-blue-50 text-[#2f65cf]";
  const inactiveClass = "transition hover:bg-slate-100";

  return (
    <header className="flex h-16 shrink-0 items-center border-b border-slate-200 bg-white px-6">
      <Link href="/" className="inline-flex shrink-0 items-center" aria-label="PicBind">
        <Image
          src="/images/wordmark.png"
          alt="PicBind"
          width={142}
          height={30}
          className="h-8 w-auto object-contain"
          priority
        />
      </Link>

      <nav className="ml-8 flex items-center gap-1 text-sm font-medium text-slate-600">
        <Link
          href="/"
          className={`inline-flex h-9 items-center gap-2 rounded-md px-3 ${active === "compress" ? activeClass : inactiveClass}`}
        >
          <FiImage className="h-4 w-4" aria-hidden="true" />
          {nav.compress}
        </Link>
        <Link
          href="/favicon-converter"
          className={`inline-flex h-9 items-center gap-2 rounded-md px-3 ${active === "favicon" ? activeClass : inactiveClass}`}
        >
          <FiGrid className="h-4 w-4" aria-hidden="true" />
          {nav.favicon}
        </Link>
        <Link
          href="/workspace"
          data-picbind-workspace-entry="true"
          className={`inline-flex h-9 items-center gap-2 rounded-md px-3 ${inactiveClass}`}
        >
          <FiFolder className="h-4 w-4" aria-hidden="true" />
          {nav.workspace}
        </Link>
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <AccountControl lang={lang} showWorkspaceEntry />
        <WorkspaceLanguageSwitcher lang={lang} onChange={onLanguageChange} />
      </div>
    </header>
  );
}
