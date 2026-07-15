"use client";

export function waitForIceGatheringComplete(
  connection: RTCPeerConnection,
  timeoutMs = 15_000,
) {
  if (connection.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("ICE candidate gathering timed out"));
    }, timeoutMs);
    const handleStateChange = () => {
      if (connection.iceGatheringState === "complete") {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      connection.removeEventListener(
        "icegatheringstatechange",
        handleStateChange,
      );
    };
    connection.addEventListener("icegatheringstatechange", handleStateChange);
  });
}
