export { MessageEventDispatcher } from "./core/event";
export type { MessageHandler, Unsubscribe } from "./core/event";
export type {
  ExternalMessageIdentity,
  MessagingChannel,
  NormalizedMessage,
  NormalizedMessageType,
  RoomChannelBinding,
} from "./core/message";
export type {
  MessageProvider,
  MessageProviderStatus,
  MessagingProviderSnapshot,
  ProviderStatusHandler,
} from "./core/provider";
export { MockMessageProvider } from "./providers/mock/provider";
export { WeixinIlinkProvider } from "./providers/weixin/provider";
export { IlinkHttpGatewayTransport } from "./providers/weixin/http-transport";
export type {
  IlinkAccountCredentials,
  IlinkGatewayTransport,
  IlinkGatewaySnapshot,
  IlinkLoginSession,
} from "./providers/weixin/provider";
// Compatibility exports for the earlier generic WeChat provider name.
export { WechatProvider } from "./providers/wechat/provider";
export type { WechatTransport } from "./providers/wechat/provider";
export { MessagingService } from "./router/dispatcher";
