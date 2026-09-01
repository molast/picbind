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
import {
  captureWorkspaceBitmap,
  WorkspaceElasticTextureTransition,
} from "./workspace-elastic-texture-transition";

type WorkspaceTransitionBitmap = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

function closeWorkspaceTransitionBitmap(bitmap: WorkspaceTransitionBitmap | null) {
  if (bitmap && "close" in bitmap && typeof (bitmap as { close?: unknown }).close === "function") {
    (bitmap as ImageBitmap).close();
  }
}

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
  transition,
  workspaceLayer = false,
  children,
}: {
  active: boolean;
  transition?: "restoring" | null;
  workspaceLayer?: boolean;
  children: React.ReactNode;
}) {
  const hiddenDuringRestore = active && transition === "restoring";
  return (
    <div
      data-picbind-workspace-layer={workspaceLayer ? "true" : undefined}
      className={`${active ? "absolute inset-0 overflow-auto" : "hidden"} ${hiddenDuringRestore ? "invisible pointer-events-none" : ""}`}
      aria-hidden={!active || hiddenDuringRestore}
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
  const [workspaceTransition, setWorkspaceTransition] = React.useState<
    "suspending" | "restoring" | null
  >(null);
  const [workspaceTransitionBitmap, setWorkspaceTransitionBitmap] = React.useState<WorkspaceTransitionBitmap | null>(null);
  const workspaceTransitionCapture = React.useRef(0);
  const setWorkspaceTransitionState = React.useCallback((transition: "suspending" | "restoring" | null) => {
    setWorkspaceTransition(transition);
  }, []);
  const replaceWorkspaceTransitionBitmap = React.useCallback((next: WorkspaceTransitionBitmap | null) => {
    setWorkspaceTransitionBitmap((current) => {
      if (current && current !== next) closeWorkspaceTransitionBitmap(current);
      return next;
    });
  }, []);
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
        if (getDesktopRoute(window.location.pathname) === "workspace") {
          const captureSequence = ++workspaceTransitionCapture.current;
          const candidates = Array.from(document.querySelectorAll<HTMLElement>(
            "[data-picbind-workspace-layer='true'], [data-picbind-workspace-content='true'], main",
          ));
          const layer = candidates.find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const style = window.getComputedStyle(candidate);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          });
          void (layer ? captureWorkspaceBitmap(layer) : Promise.resolve(null)).then((bitmap) => {
            if (captureSequence !== workspaceTransitionCapture.current) {
              closeWorkspaceTransitionBitmap(bitmap);
              return;
            }
            if (bitmap) {
              replaceWorkspaceTransitionBitmap(bitmap);
              setWorkspaceTransitionState("suspending");
            }
            router.push("/");
          }).catch(() => router.push("/"));
        }
      } else if (!detail.suspended) {
        setSuspendedWorkspace(null);
      }
    };
    window.addEventListener(WORKSPACE_SUSPENSION_EVENT, handleSuspension);
    return () => window.removeEventListener(WORKSPACE_SUSPENSION_EVENT, handleSuspension);
  }, [desktop, replaceWorkspaceTransitionBitmap, router, setWorkspaceTransitionState]);

  React.useEffect(() => () => {
    workspaceTransitionCapture.current += 1;
    replaceWorkspaceTransitionBitmap(null);
  }, [replaceWorkspaceTransitionBitmap]);

  React.useEffect(() => {
    if (!desktop) return;
    const handleExit = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceExitEventDetail>).detail;
      const workspaceId = detail?.workspace?.workspaceId;
      setSuspendedWorkspace((current) => {
        if (!current || !workspaceId || current.workspace.workspaceId === workspaceId) return null;
        return current;
      });
      setWorkspaceTransitionState(null);
      replaceWorkspaceTransitionBitmap(null);
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
  }, [desktop, replaceWorkspaceTransitionBitmap, setWorkspaceTransitionState]);

  const restoreSuspendedWorkspace = React.useCallback(() => {
    if (!suspendedWorkspace) return;
    const suspended = suspendedWorkspace;
    const target = suspended.returnHref || "/workspace";
    const animateRestore = Boolean(workspaceTransitionBitmap);
    if (animateRestore) setWorkspaceTransitionState("restoring");
    window.dispatchEvent(new CustomEvent<WorkspaceSuspensionEventDetail>(WORKSPACE_SUSPENSION_EVENT, {
      detail: { suspended: false, workspace: suspended.workspace },
    }));
    if (animateRestore) setSuspendedWorkspace(suspended);
    else setSuspendedWorkspace(null);
    router.push(target);
  }, [router, setWorkspaceTransitionState, suspendedWorkspace, workspaceTransitionBitmap]);

  const completeWorkspaceTransition = React.useCallback(() => {
    if (workspaceTransition === "suspending") {
      setWorkspaceTransitionState(null);
      return;
    }
    setSuspendedWorkspace(null);
    setWorkspaceTransitionState(null);
    replaceWorkspaceTransitionBitmap(null);
  }, [replaceWorkspaceTransitionBitmap, setWorkspaceTransitionState, workspaceTransition]);

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
    {workspaceTransitionBitmap && workspaceTransition ? (
      <WorkspaceElasticTextureTransition
        bitmap={workspaceTransitionBitmap}
        phase={workspaceTransition === "suspending" ? "out" : "in"}
        onComplete={completeWorkspaceTransition}
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
        <RouteLayer active={activeRoute === "workspace"} transition={workspaceTransition === "restoring" ? "restoring" : null} workspaceLayer>
          <React.Suspense fallback={<RouteLoading />}>
            <WorkspaceRoute />
          </React.Suspense>
        </RouteLayer>
      ) : null}

      {activeRoute === null ? (
        <div className="absolute inset-0 overflow-auto">{children}</div>
      ) : null}
      {suspendedWorkspace && (activeRoute === "home" || workspaceTransition === "suspending" || workspaceTransition === "restoring") ? (
        <WorkspaceSuspendedDock
          workspace={suspendedWorkspace.workspace}
          runtime={suspendedWorkspace.runtime}
          onRestore={restoreSuspendedWorkspace}
        />
      ) : null}
      {workspaceTransitionBitmap && workspaceTransition ? (
        <WorkspaceElasticTextureTransition
          bitmap={workspaceTransitionBitmap}
          phase={workspaceTransition === "suspending" ? "out" : "in"}
          onComplete={completeWorkspaceTransition}
        />
      ) : null}
    </div>
  );
}
