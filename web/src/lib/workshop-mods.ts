export interface ModPack {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  defaultEnabled: boolean;
  residentChars: number;
}

export interface ConversationMod {
  workshopId: string;
  kind: "dlc" | "lorebook" | "universal";
  name: string;
  coverUrl?: string;
  status: "resident" | "triggered" | "disabled" | "removed";
  reason?: string;
  enabled: boolean;
  residentChars: number;
  packs?: ModPack[];
  packCount?: number;
  enabledPackCount?: number;
  packCatalogVersion?: string;
  scriptCanSwitchPacks?: boolean;
}

export interface ConversationMods {
  version: string;
  items: ConversationMod[];
  availableCount: number;
  triggeredCount: number;
  workshopClosed: boolean;
  openingName?: string;
  privateEntryCount: number;
  activePrivateEntryCount: number;
}

export type ModAction =
  | { action: "toggle"; workshopId: string; enabled: boolean }
  | { action: "packs"; packs: Array<{ workshopId: string; packId: string; enabled: boolean }> }
  | { action: "order"; order: string[] }
  | { action: "remove"; workshopId: string }
  | { action: "add" }
  | { action: "join_universal"; workshopId: string }
  | { action: "private_entry"; entryId: string; enabled: boolean };

export interface PrivateModEntry {
  id: string;
  name: string;
  content: string;
  keywords: string[];
}

export interface PrivateModBook {
  revision: string;
  entryContentMax: number;
  version: string;
  entries: Array<PrivateModEntry & { enabled: boolean; resident?: boolean }>;
  residentChars: number;
}

export interface UniversalMod {
  id: string;
  revision: string;
  name: string;
  summary: string;
  entries: PrivateModEntry[];
}

export interface UniversalModChoice {
  id: string;
  name: string;
  summary: string;
  entryCount: number;
  residentChars: number;
  updatedAt: number;
  joined: boolean;
}

export const WORKSHOP_PACK_LIMIT = 10_000;
export const WORKSHOP_INLINE_PACKS = 20;

export function filterWorkshopPacks<T extends { name: string; description?: string }>(packs: readonly T[], query: string): readonly T[] {
  const term = query.trim().toLowerCase();
  if (!term) return packs;
  return packs.filter(pack => pack.name.toLowerCase().includes(term) || pack.description?.toLowerCase().includes(term));
}
