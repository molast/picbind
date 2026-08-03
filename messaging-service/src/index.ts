export { MessageEventDispatcher } from "./core/event.js";
export type { MessageHandler, Unsubscribe } from "./core/event.js";
export type {
  ExternalMessageIdentity,
  MessagingChannel,
  NormalizedMessage,
  NormalizedMessageType,
  RoomChannelBinding,
} from "./core/message.js";
export type {
  MessageProvider,
  MessageProviderStatus,
  MessagingProviderSnapshot,
  ProviderStatusHandler,
} from "./core/provider.js";
export { MockMessageProvider } from "./providers/mock/provider.js";
export { WeixinIlinkProvider } from "./providers/weixin/provider.js";
export { IlinkHttpGatewayTransport } from "./providers/weixin/http-transport.js";
export type {
  IlinkAccountCredentials,
  IlinkGatewayTransport,
  IlinkGatewaySnapshot,
  IlinkLoginSession,
} from "./providers/weixin/provider.js";
// Compatibility exports for the earlier generic WeChat provider name.
export { WechatProvider } from "./providers/wechat/provider.js";
export type { WechatTransport } from "./providers/wechat/provider.js";
export { MessagingService } from "./router/dispatcher.js";
