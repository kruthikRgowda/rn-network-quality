import type { NetworkQualityErrorCode } from './types';

/** Error raised by monitoring and probing operations. */
export class NetworkQualityError extends Error {
  /** Stable machine-readable error code. */
  public readonly code: NetworkQualityErrorCode;

  /** Original platform error, when one is available. */
  public override readonly cause?: unknown;

  /** Creates a network-quality error with a stable code and helpful message. */
  public constructor(
    code: NetworkQualityErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = 'NetworkQualityError';
    this.code = code;
    this.cause = options?.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
