import { COMMUNITY_API, UPSTREAM_API } from './config';
import { currentProvider } from './provider';
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
  conversationId: string;
  conversationRoleId: string;
  conversationTitle: string | null;
  roleName: string;
  roleAvatar: string;
  lastChat: string;
  lastChatTime?: string;
  createTime?: string;
}
export async function fetchConversations(token: string, language: string, page = 1) {
  const result = await read<{ conversations: ConversationSummary[] | null; hasNextPage: boolean }>(await fetch(
    `${UPSTREAM_API}/open/v1/conversation/list?pageNum=${page}&pageSize=24`,
    { cache: 'no-store', headers: { Authorization: `Bearer ${token}`, language } },
  ));
  return { ...result, conversations: result.conversations ?? [] };
}
