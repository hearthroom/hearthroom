import { COMMUNITY_API } from './config';
import { currentProvider, type ProviderId } from './provider';
import { ApiError, describeApiError } from './api';

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) throw new ApiError(response.status, describeApiError(response.status, ''));
  return response.json() as Promise<T>;
}
export async function libraryRequest<T>(path: string, token: string, method = 'GET'): Promise<T> {
  return read<T>(await fetch(`${COMMUNITY_API}/me/${path}`, {
    method, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'X-Provider': currentProvider() },
  }));
}
export interface ConversationSummary {
  provider: ProviderId;
  conversationId: string;
  conversationRoleId: string;
  conversationTitle: string | null;
  roleName: string;
  roleAvatar: string;
  lastChat?: string;
  lastChatTime?: string;
  createTime?: string;
}
export async function fetchConversations(token: string, language: string, page = 1) {
  return libraryRequest<{ conversations: ConversationSummary[]; hasNextPage: boolean }>(
    `conversations?pageNum=${page}&lang=${encodeURIComponent(language)}`, token);
}

export async function recordConversation(token: string, provider: ProviderId, roleId: string, conversationId: string): Promise<void> {
  await read(await fetch(`${COMMUNITY_API}/me/conversations`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'X-Provider': provider, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleId, conversationId }),
  }));
}
