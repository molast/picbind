"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/nav";
import { Footer } from "@/components/footer";

const STANDALONE_ROUTES = new Set(["/", "/toolbox"]);

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStandalone = STANDALONE_ROUTES.has(pathname);

  return (
    <div id="root-layout" className="min-h-screen flex flex-col">
      {!isStandalone && <Navbar />}
      <div id="layout-main" className={isStandalone ? "flex grow" : "flex grow py-12"}>
        {children}
      </div>
      {!isStandalone && <Footer />}
    </div>
  );
}
