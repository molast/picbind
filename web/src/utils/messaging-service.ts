"use client";

import {
  IlinkHttpGatewayTransport,
  MessagingService,
  WeixinIlinkProvider,
} from "@picbind/room/source";

const gatewayUrl = process.env.NEXT_PUBLIC_MESSAGING_GATEWAY_URL?.trim();

export const messagingService = gatewayUrl
  ? new MessagingService([
      new WeixinIlinkProvider(new IlinkHttpGatewayTransport(gatewayUrl)),
    ])
  : undefined;
