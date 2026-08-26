export type DesktopRoute = "home" | "favicon" | "workspace";

export function getDesktopRoute(pathname: string): DesktopRoute | null {
  if (pathname === "/") return "home";
  if (pathname === "/favicon-converter" || pathname === "/favicon-generator") {
    return "favicon";
  }
  if (pathname === "/workspace") return "workspace";
  return null;
}

export function retainDesktopRoute(
  mountedRoutes: Set<DesktopRoute>,
  route: DesktopRoute,
): Set<DesktopRoute> {
  if (mountedRoutes.has(route)) return mountedRoutes;
  const next = new Set(mountedRoutes);
  next.add(route);
  return next;
}
