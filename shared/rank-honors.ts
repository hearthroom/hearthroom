export type RankZone='clean'|'all';
export type RankWindow='day'|'week'|'month';
export type RankBand=1|3|10;
export interface RankHonor {zone:RankZone;window:RankWindow;band:RankBand}
export interface DatedRankHonor extends RankHonor {period:string;at:number;settledAt:number;rank:number}
