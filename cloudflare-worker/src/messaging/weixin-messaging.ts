import type { WeixinMessagingEnv } from "./weixin-messaging-object";

export type MessagingWorkerEnv = WeixinMessagingEnv & {
  WEIXIN_MESSAGING: DurableObjectNamespace;
};

const BASE_PATH = "/api/messaging/weixin";
const CLIENT_ID_PATTERN = /^[a-f0-9]{32}$/;

export async function handleWeixinMessaging(
  request: Request,
  env: MessagingWorkerEnv,
) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "";
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    return new Response(
      JSON.stringify({ error: "Invalid messaging client ID" }),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }
  const suffix = url.pathname.slice(BASE_PATH.length) || "/status";
  const internalUrl = new URL(`https://weixin-messaging${suffix}`);
  internalUrl.search = url.search;
  const stub = env.WEIXIN_MESSAGING.get(
    env.WEIXIN_MESSAGING.idFromName(clientId),
  );
  return stub.fetch(new Request(internalUrl, request));
}
