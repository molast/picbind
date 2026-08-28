import type { RealtimeService } from "@picbind/shared";
import { WorkspaceRealtimeService } from "@picbind/ui/source";
import { isTauri } from "@tauri-apps/api/core";
import { BrowserRealtimePeerFactory } from "./adapters/browser-peer";
import { BrowserRealtimeSocketFactory } from "./adapters/browser-socket";
import { NativeRealtimePeerFactory } from "./adapters/native-peer";
import { TauriRealtimeSocketFactory } from "./adapters/tauri-socket";

let service: RealtimeService | null = null;

export function createRealtimeService(): RealtimeService {
  service ??= isTauri()
    ? new WorkspaceRealtimeService({
      socketFactory: new TauriRealtimeSocketFactory(),
      peerFactory: new NativeRealtimePeerFactory(),
    })
    : new WorkspaceRealtimeService({
      socketFactory: new BrowserRealtimeSocketFactory(),
      peerFactory: new BrowserRealtimePeerFactory(),
    });
  return service;
}
