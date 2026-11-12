import { COMMUNITY_API } from './config';
import { currentProvider, type ProviderId } from './provider';
import { ApiError, describeApiError } from './api';
import type {CommunityCard} from './types';
export interface UnavailableFavorite {unavailable:true;bookmarkId:string}
export type LibraryFavorite=CommunityCard|UnavailableFavorite;
export const isUnavailableFavorite=(value:LibraryFavorite):value is UnavailableFavorite=>'unavailable' in value&&value.unavailable===true;

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // 錯誤碼要留著：舊聊天連結被地區擋下（region_unavailable）時，遊玩頁要畫「暫不提供」那一頁
    const code = ((await response.json().catch(() => null)) as { error?: unknown } | null)?.error;
    const raw = typeof code === 'string' ? code : '';
    throw new ApiError(response.status, describeApiError(response.status, ''), raw);
  }
  return response.json() as Promise<T>;
}
// Per-tab, per-credential memory only. No private response enters a shared/persistent cache.
const privateReads=new Map<string,{expires:number;promise:Promise<unknown>}>();
let activeCredential='',activeProvider='';
export function clearLibraryCache(){privateReads.clear();activeCredential='';activeProvider='';}
export async function libraryRequest<T>(path: string, token: string, method = 'GET'): Promise<T> {
  const provider=currentProvider();
  if(activeCredential!==token||activeProvider!==provider){clearLibraryCache();activeCredential=token;activeProvider=provider;}
  if(method!=='GET')privateReads.clear();
  const cacheable=method==='GET'&&!/^(conversations|favorites|feed)(?:[/?]|$)/.test(path);
  const cached=cacheable?privateReads.get(path):undefined;
  if(method==='GET'&&cached&&cached.expires>Date.now())return cached.promise as Promise<T>;
  const promise=(async()=>{
    try {return await read<T>(await fetch(`${COMMUNITY_API}/me/${path}`, {
      method, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'X-Provider': provider },
    }));} finally {if(method!=='GET')privateReads.clear();}
  })();
  if(cacheable){
    privateReads.set(path,{expires:Date.now()+30000,promise});
    if(privateReads.size>100)privateReads.delete(privateReads.keys().next().value!);
    void promise.catch(()=>{if(privateReads.get(path)?.promise===promise)privateReads.delete(path);});
  }
  return promise;
}
export interface ConversationSummary {
  canGenerate?: boolean;
  reason?: 'author_private'|'restricted'|'unavailable';
  provider: ProviderId;
  conversationId: string;
  conversationRoleId: string;
  cardNumber?: number | null;
  /** 成人卡：清單照收藏區規則照列，首頁面板要自己照開關藏 */
  adult?: boolean;
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

export interface ConversationDeletionPreview {
  selectionToken: string;
  groups: { roleId: string; conversationId: string; count: number }[];
  total: number;
}
export interface ConversationDeletionResult {
  results: { roleId: string; conversationId: string; status: 'deleted' | 'busy' | 'error'; deletedCount: number }[];
  deletedCount: number;
}
async function deletionRequest<T>(token: string, path: string, method: string, body: unknown): Promise<T> {
  clearLibraryCache();
  try {
    return await read<T>(await fetch(`${COMMUNITY_API}/me/conversations${path}`, {
      method, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'X-Provider': currentProvider(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  } finally { clearLibraryCache(); }
}
export function previewConversationDeletion(token: string, conversations: ConversationSummary[]) {
  return deletionRequest<ConversationDeletionPreview>(token, '/delete-preview', 'POST', {
    conversations: conversations.map(({ conversationRoleId, conversationId }) => ({ conversationRoleId, conversationId })),
  });
}
export function deleteConversations(token: string, selectionToken: string, conversationIds?: string[]) {
  return deletionRequest<ConversationDeletionResult>(token, '', 'DELETE', { selectionToken, ...(conversationIds ? { conversationIds } : {}) });
}

export async function recordConversation(token: string, provider: ProviderId, roleId: string, conversationId: string): Promise<{ first?: boolean }> {
  clearLibraryCache();
  try { return await read<{ first?: boolean }>(await fetch(`${COMMUNITY_API}/me/conversations`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'X-Provider': provider, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleId, conversationId }),
  })); } finally { clearLibraryCache(); }
}
