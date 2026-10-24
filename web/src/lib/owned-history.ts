import { apiBaseOf, type ProviderId } from './provider';
import { ApiError, describeApiError } from './api';

export type HistoryAccessReason = 'author_private' | 'restricted' | 'unavailable';
export interface OwnedHistory {
  conversationId: string;
  roleId: string;
  title: string;
  canGenerate: boolean;
  reason?: HistoryAccessReason;
}
/** Credentials go only to the selected, configured issuer. Never cache policy. */
export async function fetchOwnedHistory(provider: ProviderId, conversationId: string, token: string): Promise<OwnedHistory> {
  const response = await fetch(`${apiBaseOf(provider)}/open/v1/conversation/owned?conversationId=${encodeURIComponent(conversationId)}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  if (!response.ok) throw new ApiError(response.status, describeApiError(response.status, ''));
  const body = await response.json() as OwnedHistory;
  if (body.conversationId !== conversationId || typeof body.roleId !== 'string' || typeof body.canGenerate !== 'boolean') throw new Error('invalid_owned_history');
  return body;
}
