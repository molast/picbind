"use client";

import React from "react";
import { RealtimeProvider } from "@picbind/ui/source";
import { createRealtimeService } from "./create-realtime-service";

export function RealtimeProviderRoot({ children }: React.PropsWithChildren) {
  const service = React.useMemo(() => createRealtimeService(), []);
  return <RealtimeProvider service={service}>{children}</RealtimeProvider>;
}
