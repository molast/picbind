export type RealtimeMessageChannel = {
  readonly readyState: RTCDataChannelState;
  send(data: string): void;
};
