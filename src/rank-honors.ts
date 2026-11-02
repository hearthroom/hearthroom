import type {DatedRankHonor} from '../shared/rank-honors';
/** Correlated into the existing card query, avoiding one D1 call per cover. */
export const COVER_HONORS=`(SELECT json_group_array(json_object('zone',CASE priority%2 WHEN 0 THEN 'clean' ELSE 'all' END,'window',window,'band',CAST(priority/2 AS INTEGER))) FROM (
 SELECT window,MIN(band*2+CASE zone WHEN 'clean' THEN 0 ELSE 1 END) AS priority FROM rank_awards WHERE card_id=c.id GROUP BY window))`;
export async function allCardHonors(db:D1Database,id:number):Promise<(DatedRankHonor&{period:string})[]> {
 return (await db.prepare('SELECT zone,window,band,period,rank,awarded_at AS at,awarded_at AS settledAt FROM rank_awards WHERE card_id=? ORDER BY awarded_at DESC,period DESC,window,zone').bind(id).all<DatedRankHonor&{period:string}>()).results;
}
