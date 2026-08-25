import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheOAuthAvatar, handleOAuthAvatar, type OAuthAvatarEnv } from "../src/oauth-avatar";

type StoredAvatar = {
  key: string;
  bytes: Uint8Array;
  options: R2PutOptions;
};

function avatarEnv() {
  let stored: StoredAvatar | null = null;
  const bucket = {
    async put(key: string, value: ArrayBuffer, options: R2PutOptions) {
      stored = { key, bytes: new Uint8Array(value), options };
      return {};
    },
    async get(key: string) {
      if (!stored || stored.key !== key) return null;
      return {
        body: new Blob([stored.bytes]).stream(),
        httpEtag: '"avatar-etag"',
        httpMetadata: stored.options.httpMetadata,
      };
    },
  } as unknown as R2Bucket;
  return {
    env: {
      SHARE_IMAGES_R2: bucket,
      OAUTH_CALLBACK_ORIGIN: "https://api.picbind.com",
    } satisfies OAuthAvatarEnv,
    stored: () => stored,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("OAuth avatar cache", () => {
  for (const [provider, sourceUrl] of [
    ["google", "https://lh3.googleusercontent.com/a/google-avatar=s96-c"],
    ["github", "https://avatars.githubusercontent.com/u/123?v=4"],
  ] as const) {
    it(`stores the ${provider} avatar under the PicBind User`, async () => {
      const { env, stored } = avatarEnv();
      vi.stubGlobal("fetch", vi.fn(async () => new Response(
        new Uint8Array([1, 2, 3, 4]),
        { status: 200, headers: { "content-type": "image/png" } },
      )));

      const url = await cacheOAuthAvatar(env, "https://api.picbind.com", `user_${provider}`, sourceUrl);

      expect(url).toBe(`https://api.picbind.com/api/auth/avatars/user_${provider}`);
      expect(stored()).toMatchObject({
        key: `auth/avatars/user_${provider}`,
        bytes: new Uint8Array([1, 2, 3, 4]),
        options: { httpMetadata: { contentType: "image/png" } },
      });
    });
  }

  it("does not fetch avatars from an untrusted host", async () => {
    const { env, stored } = avatarEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(cacheOAuthAvatar(
      env,
      "https://api.picbind.com",
      "user_invalid",
      "https://example.com/avatar.png",
    )).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stored()).toBeNull();
  });

  it("serves the cached avatar from the PicBind URL", async () => {
    const { env } = avatarEnv();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      new Uint8Array([5, 6, 7]),
      { status: 200, headers: { "content-type": "image/webp" } },
    )));
    await cacheOAuthAvatar(
      env,
      "https://api.picbind.com",
      "user_cached",
      "https://avatars.githubusercontent.com/u/456?v=4",
    );

    const response = await handleOAuthAvatar(
      new Request("https://api.picbind.com/api/auth/avatars/user_cached"),
      env,
      "user_cached",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([5, 6, 7]);
  });
});
