import { describe, expect, it } from "vitest";
import { isDesktopLoopbackReturnTo } from "../src/oauth";

describe("desktop OAuth return URL", () => {
  it("accepts only the fixed callback path on an IPv4 loopback random port", () => {
    expect(isDesktopLoopbackReturnTo(new URL(
      "http://127.0.0.1:49152/picbind/oauth/callback",
    ))).toBe(true);
    expect(isDesktopLoopbackReturnTo(new URL(
      "http://localhost:49152/picbind/oauth/callback",
    ))).toBe(false);
    expect(isDesktopLoopbackReturnTo(new URL(
      "http://127.0.0.1:49152/other",
    ))).toBe(false);
    expect(isDesktopLoopbackReturnTo(new URL(
      "https://127.0.0.1:49152/picbind/oauth/callback",
    ))).toBe(false);
    expect(isDesktopLoopbackReturnTo(new URL(
      "http://127.0.0.1:49152/picbind/oauth/callback?redirect=https://evil.test",
    ))).toBe(false);
    expect(isDesktopLoopbackReturnTo(new URL(
      "http://127.0.0.1:49152/picbind/oauth/callback#code",
    ))).toBe(false);
  });
});
