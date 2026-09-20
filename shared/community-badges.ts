export const BADGE_ICONS = ['discord','spark','flame','lantern','star','crown','award'] as const;
export type BadgeIcon = typeof BADGE_ICONS[number];
export interface BadgeDefinition { key:string; icon:BadgeIcon; category:string; titles:Record<string,string>; descriptions:Record<string,string> }
export interface CollectedBadge extends BadgeDefinition { state:'earned'|'locked'|'revoked'|'expired'; earnedAt:number|null; expiresAt:number|null; progress?:{value:number;target:number} }
export interface BadgeCollection { items:CollectedBadge[]; featured:string[]; public?:boolean; canManage?:boolean }
export function badgeText(values:Record<string,string>,locale:string):string { return values[locale] || values.en || values['zh-Hant'] || Object.values(values)[0] || ''; }
