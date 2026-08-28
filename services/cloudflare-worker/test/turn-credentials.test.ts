import { describe, expect, it } from "vitest";
import { normalizeTurnIceServers } from "../src/realtime/turn-credentials";

describe("TURN credentials", () => {
  it("deduplicates and caps ICE discovery while preserving protocol coverage", () => {
    const normalized = normalizeTurnIceServers([{
      urls: [
        "turn:turn.example.com:80?transport=tcp",
        "turn:turn.example.com:3478?transport=udp",
        "turns:turn.example.com:5349?transport=tcp",
        "turns:turn.example.com:443?transport=tcp",
        "turn:turn.example.com:3478?transport=tcp",
        "turn:turn.example.com:3478?transport=udp",
      ],
      username: "user",
      credential: "secret",
    }, {
      urls: "stun:stun.example.com:3478",
    }]);

    expect(normalized).toHaveLength(4);
    expect(normalized.map((server) => server.urls)).toEqual([
      ["stun:stun.example.com:3478"],
      ["turn:turn.example.com:3478?transport=udp"],
      ["turns:turn.example.com:443?transport=tcp"],
      ["turn:turn.example.com:80?transport=tcp"],
    ]);
    expect(normalized[1]).toMatchObject({ username: "user", credential: "secret" });
  });
});
