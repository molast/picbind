"use client";

import {
  IlinkHttpGatewayTransport,
  MessagingService,
  WeixinIlinkProvider,
} from "@picbind/room/source";

const gatewayUrl =
  process.env.NEXT_PUBLIC_MESSAGING_GATEWAY_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
  "https://api.picbind.com";

export const messagingService = new MessagingService([
  new WeixinIlinkProvider(new IlinkHttpGatewayTransport(gatewayUrl)),
]);
