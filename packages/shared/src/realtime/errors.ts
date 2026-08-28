export type RealtimeErrorCode =
  | "ticketFailed"
  | "socketConnectFailed"
  | "socketClosed"
  | "socketQueueFull"
  | "rtcUnavailable"
  | "rtcSignalFailed"
  | "rtcDataChannelFailed"
  | "rtcBackpressure"
  | "invalidFrame"
  | "deliveryRejected"
  | "cancelled"
  | "internal";

export type RealtimeError = {
  code: RealtimeErrorCode;
  message: string;
  retryable: boolean;
  cause?: unknown;
};

export class RealtimeTransportError extends Error {
  readonly name = "RealtimeTransportError";

  constructor(
    readonly code: RealtimeErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
  }

  toRealtimeError(): RealtimeError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      cause: this.cause,
    };
  }
}

export function toRealtimeError(
  value: unknown,
  fallback: Pick<RealtimeError, "code" | "message" | "retryable">,
): RealtimeError {
  if (value instanceof RealtimeTransportError) return value.toRealtimeError();
  return { ...fallback, cause: value };
}
