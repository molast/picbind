"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { isTauri } from "@tauri-apps/api/core";
import {
  WORKSPACE_EXIT_EVENT,
  WORKSPACE_SUSPENSION_EVENT,
  WorkspaceSuspendedDock,
  type WorkspaceIdentity,
  type WorkspaceExitEventDetail,
  type WorkspaceRuntimeState,
  type WorkspaceSuspensionEventDetail,
} from "@picbind/ui/source";
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
  const [suspendedWorkspace, setSuspendedWorkspace] = React.useState<{
    workspace: WorkspaceIdentity;
    runtime: WorkspaceRuntimeState;
    returnHref: string;
  } | null>(null);
  const activeRoute = getDesktopRoute(pathname);
  React.useEffect(() => {
    setDesktop(isTauri());
  }, []);

  React.useEffect(() => {
    if (!desktop || !activeRoute) return;
    setMountedRoutes((current) => retainDesktopRoute(current, activeRoute));
  }, [activeRoute, desktop]);

  React.useEffect(() => {
    const handleSuspension = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceSuspensionEventDetail>).detail;
      if (!detail) return;
      if (detail.suspended && detail.workspace) {
        const workspace = detail.workspace;
        setSuspendedWorkspace((current) => {
          if (current?.workspace.workspaceId === workspace.workspaceId) {
            return { ...current, runtime: detail.runtime || current.runtime };
          }
          return {
            workspace,
            runtime: detail.runtime || "available",
            returnHref: `${window.location.pathname}${window.location.search}${window.location.hash}`,
          };
        });
        if (desktop && getDesktopRoute(window.location.pathname) === "workspace") {
          router.push("/");
        }
      } else if (!detail.suspended) {
        setSuspendedWorkspace(null);
      }
    };
    window.addEventListener(WORKSPACE_SUSPENSION_EVENT, handleSuspension);
    return () => window.removeEventListener(WORKSPACE_SUSPENSION_EVENT, handleSuspension);
  }, [desktop, router]);

  React.useEffect(() => {
    if (!desktop) return;
    const handleExit = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceExitEventDetail>).detail;
      const workspaceId = detail?.workspace?.workspaceId;
      setSuspendedWorkspace((current) => {
        if (!current || !workspaceId || current.workspace.workspaceId === workspaceId) return null;
        return current;
      });
      setMountedRoutes((current) => {
        if (!current.has("workspace")) return current;
        const next = new Set(current);
        next.delete("workspace");
        next.add("home");
        return next;
      });
    };
    window.addEventListener(WORKSPACE_EXIT_EVENT, handleExit);
    return () => window.removeEventListener(WORKSPACE_EXIT_EVENT, handleExit);
  }, [desktop]);

  const restoreSuspendedWorkspace = React.useCallback(() => {
    if (!suspendedWorkspace) return;
    const suspended = suspendedWorkspace;
    const target = suspended.returnHref || "/workspace";
    setSuspendedWorkspace(null);
    window.dispatchEvent(new CustomEvent<WorkspaceSuspensionEventDetail>(WORKSPACE_SUSPENSION_EVENT, {
      detail: { suspended: false, workspace: suspended.workspace },
    }));
    router.push(target);
  }, [router, suspendedWorkspace]);

  React.useEffect(() => {
    const handleNavigate = (event: Event) => {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href;
      if (!href) return;
      if (href === "/workspace" && suspendedWorkspace) {
        restoreSuspendedWorkspace();
        return;
      }
      router.push(href);
    };
    window.addEventListener("picbind:navigate", handleNavigate);
    return () => window.removeEventListener("picbind:navigate", handleNavigate);
  }, [restoreSuspendedWorkspace, router, suspendedWorkspace]);

  const handleLinkNavigation = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    const isWorkspaceEntry = anchor.dataset.picbindWorkspaceEntry === "true";
    if (!desktop && !(isWorkspaceEntry && suspendedWorkspace)) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    event.preventDefault();
    const href = `${destination.pathname}${destination.search}${destination.hash}`;
    if (isWorkspaceEntry && suspendedWorkspace) {
      restoreSuspendedWorkspace();
      return;
    }
    router.push(href);
  }, [desktop, restoreSuspendedWorkspace, router, suspendedWorkspace]);

  if (desktop !== true) return <div className="contents" onClickCapture={handleLinkNavigation}>
    {children}
    {suspendedWorkspace && activeRoute === "home" ? (
      <WorkspaceSuspendedDock
        workspace={suspendedWorkspace.workspace}
        runtime={suspendedWorkspace.runtime}
        onRestore={restoreSuspendedWorkspace}
      />
    ) : null}
  </div>;

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
      {suspendedWorkspace && activeRoute === "home" ? (
        <WorkspaceSuspendedDock
          workspace={suspendedWorkspace.workspace}
          runtime={suspendedWorkspace.runtime}
          onRestore={restoreSuspendedWorkspace}
        />
      ) : null}
    </div>
  );
}
