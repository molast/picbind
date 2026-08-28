"use client";

import React from "react";
import type { RealtimeService } from "@picbind/shared";

const RealtimeContext = React.createContext<RealtimeService | null>(null);

export function RealtimeProvider({ service, children }: React.PropsWithChildren<{
  service: RealtimeService;
}>) {
  return <RealtimeContext.Provider value={service}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeService() {
  const service = React.useContext(RealtimeContext);
  if (!service) throw new Error("RealtimeProvider is missing");
  return service;
}
