export type RoomSdkConfig = {
  apiBaseUrl?: string;
  createRoomUrl?: string;
  roomUrl?: string;
  wasmBaseUrl?: string;
};

const runtimeConfig: RoomSdkConfig = {};

export function configureRoomSdk(config: RoomSdkConfig) {
  Object.assign(runtimeConfig, config);
}

export function getRoomSdkConfig() {
  return runtimeConfig;
}

export function getRoomShareUrl(roomId: string) {
  const configured = runtimeConfig.roomUrl?.trim();
  if (!configured || typeof window === "undefined") {
    return typeof window === "undefined" ? "" : window.location.href;
  }
  const url = new URL(configured, window.location.origin);
  url.searchParams.set("roomId", roomId);
  return url.toString();
}
