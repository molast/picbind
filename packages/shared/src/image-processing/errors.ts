export type ImageProcessingErrorCode =
  | "cancelled"
  | "invalidRequest"
  | "sourceNotFound"
  | "sourceChanged"
  | "unsupportedInputFormat"
  | "unsupportedOutputFormat"
  | "unsupportedOperation"
  | "inputTooLarge"
  | "pixelLimitExceeded"
  | "decodeFailed"
  | "renderFailed"
  | "encodeFailed"
  | "alphaLossForbidden"
  | "capabilityUnavailable"
  | "storageFailed"
  | "internal";

export class ImageProcessingError extends Error {
  readonly name = "ImageProcessingError";

  constructor(
    readonly code: ImageProcessingErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function isImageProcessingError(error: unknown): error is ImageProcessingError {
  return error instanceof ImageProcessingError;
}
