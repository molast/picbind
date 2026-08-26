"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { isTauri } from "@tauri-apps/api/core";
import {
  getDesktopRoute,
  retainDesktopRoute,
  type DesktopRoute,
} from "./desktop-route";

const HomePageStack = React.lazy(() => import("@/components/home/home-page-stack"));
const FaviconGeneratorPage = React.lazy(
  () => import("@/components/favicon/favicon-generator-page"),
);
const WorkspaceRoute = React.lazy(() => import("@/components/workspace-route"));

function RouteLoading() {
  return <main className="h-[100dvh] min-h-[640px] bg-[#f5f7fa]" />;
}

function RouteLayer({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={active ? "absolute inset-0 overflow-auto" : "hidden"}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

export default function DesktopRouteStack({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [desktop, setDesktop] = React.useState<boolean | null>(null);
  const [mountedRoutes, setMountedRoutes] = React.useState<Set<DesktopRoute>>(
    () => new Set(),
  );
  const activeRoute = getDesktopRoute(pathname);

  React.useEffect(() => {
    setDesktop(isTauri());
  }, []);

  React.useEffect(() => {
    if (!desktop || !activeRoute) return;
    setMountedRoutes((current) => retainDesktopRoute(current, activeRoute));
  }, [activeRoute, desktop]);

  React.useEffect(() => {
    if (!desktop) return;
    const handleNavigate = (event: Event) => {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href;
      if (href) router.push(href);
    };
    window.addEventListener("picbind:navigate", handleNavigate);
    return () => window.removeEventListener("picbind:navigate", handleNavigate);
  }, [desktop, router]);

  const handleLinkNavigation = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!desktop || event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    event.preventDefault();
    router.push(`${destination.pathname}${destination.search}${destination.hash}`);
  }, [desktop, router]);

  if (desktop !== true) return children;

  const shouldMount = (route: DesktopRoute) =>
    route === activeRoute || mountedRoutes.has(route);

  return (
    <div
      className="relative h-[100dvh] min-h-[640px] overflow-hidden"
      onClickCapture={handleLinkNavigation}
    >
      {shouldMount("home") ? (
        <RouteLayer active={activeRoute === "home"}>
          <React.Suspense fallback={<RouteLoading />}>
            <HomePageStack initialLang="en" />
          </React.Suspense>
        </RouteLayer>
      ) : null}

      {shouldMount("favicon") ? (
        <RouteLayer active={activeRoute === "favicon"}>
          <React.Suspense fallback={<RouteLoading />}>
            <FaviconGeneratorPage
              initialMode={pathname === "/favicon-generator" ? "text" : "image"}
            />
          </React.Suspense>
        </RouteLayer>
      ) : null}

      {shouldMount("workspace") ? (
        <RouteLayer active={activeRoute === "workspace"}>
          <React.Suspense fallback={<RouteLoading />}>
            <WorkspaceRoute />
          </React.Suspense>
        </RouteLayer>
      ) : null}

      {activeRoute === null ? (
        <div className="absolute inset-0 overflow-auto">{children}</div>
      ) : null}
    </div>
  );
}
