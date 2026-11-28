import { HttpError } from './types';

export type ReadFailureReason = 'timeout' | 'transport' | 'http_5xx' | 'http_4xx' | 'http_429' | 'http_other' | 'invalid_response' | 'missing_key';

export class VisibilityProviderUnavailable extends HttpError {
  constructor(readonly reason: ReadFailureReason) { super(503, 'visibility_provider_unavailable'); }
}

export class AggregateProofD1ScanError extends Error {}

const D1_ERROR = /^(?:D1_(?:[A-Z]+_)?ERROR:|D1 DB\b)/i;
const D1_OVERLOAD = /\bD1 DB is overloaded\b|\(7429\)|(?:\bcode\s*[:=]?\s*|^D1_(?:[A-Z]+_)?ERROR:\s*)7429\b/i;
const D1_TIMEOUT = /\b(?:timed out|timeout)\b/i;
const PROOF_UNAVAILABLE = new Set([
  'visibility_provider_unavailable',
  'visibility_read_budget_exceeded',
  'visibility_sync_pending',
]);

export function publicReadFailureDetail(error: Error): string {
  if (error instanceof VisibilityProviderUnavailable) return 'public_provider_unavailable';
  if (error instanceof HttpError) {
    if (error.status === 502) return 'public_provider_unavailable';
    if (error.status === 503 && PROOF_UNAVAILABLE.has(error.message)) return 'public_proof_unavailable';
  }

  let fromD1 = false;
  let timedOut = false;
  // The aggregate scan and D1 binding can each wrap the original error.
  let cause: unknown = error;
  for (let depth = 0; depth < 4 && cause instanceof Error; depth++, cause = cause.cause) {
    fromD1 ||= cause instanceof AggregateProofD1ScanError || D1_ERROR.test(cause.message);
    if (!fromD1) continue;
    const code = 'code' in cause ? cause.code : undefined;
    if (code === 7429 || code === '7429' || D1_OVERLOAD.test(cause.message)) return 'public_d1_overloaded';
    timedOut ||= cause.name === 'TimeoutError' || D1_TIMEOUT.test(cause.message);
  }
  return timedOut ? 'public_d1_timeout' : 'public_other';
}
