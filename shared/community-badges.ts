export const BADGE_ICONS = ['discord','spark','flame','lantern','star','crown','award','book','trophy','heart','users','compass','bookmark','chat','pen','seedling','clock'] as const;
export type BadgeIcon = typeof BADGE_ICONS[number];
/** Catalog sections in display order; unknown categories fall to the end. */
export const BADGE_CATEGORIES = ['connection','activity','supporter','creation','play','social','member','event'] as const;
/** How many earned badges a member can pin beside their profile. */
export const FEATURED_LIMIT = 5;
export interface BadgeDefinition { key:string; icon:BadgeIcon; category:string; titles:Record<string,string>; descriptions:Record<string,string> }
export interface BadgeProgress { value:number; target:number; unit?:'xp'|'days' }
export interface CollectedBadge extends BadgeDefinition { state:'earned'|'locked'|'revoked'|'expired'; earnedAt:number|null; expiresAt:number|null; progress?:BadgeProgress }
export interface BadgeCollection { items:CollectedBadge[]; featured:string[]; public?:boolean; canManage?:boolean }
export function badgeText(values:Record<string,string>,locale:string):string { return values[locale] || values.en || values['zh-Hant'] || Object.values(values)[0] || ''; }
