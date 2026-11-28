import { HttpError } from './types';

export type ReadFailureReason = 'timeout' | 'transport' | 'http_5xx' | 'http_4xx' | 'http_429' | 'http_other' | 'invalid_response' | 'missing_key';

export class VisibilityProviderUnavailable extends HttpError {
  constructor(readonly reason: ReadFailureReason) { super(503, 'visibility_provider_unavailable'); }
}

export class AggregateProofD1ScanError extends Error {}
