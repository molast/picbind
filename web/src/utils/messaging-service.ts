"use client";

import {
  IlinkTauriTransport,
  MessagingService,
  WeixinIlinkProvider,
} from "@picbind/room/source";
import { isTauri } from "@tauri-apps/api/core";

export const messagingService =
  typeof window !== "undefined" && isTauri()
    ? new MessagingService([
        new WeixinIlinkProvider(new IlinkTauriTransport()),
      ])
    : undefined;
