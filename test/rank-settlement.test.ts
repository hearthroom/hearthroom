import {expect,it} from 'vitest';
import {cohortOf,heatFormulaOf,rankCohort} from '../src/rank-settlement';
const at=(value:string)=>Date.parse(value+'+08:00');
it('uses Taipei calendar cohorts and waits until every entrant can finish its own window',()=>{
 expect(cohortOf(at('2026-10-18T23:59:00'),'day')).toEqual({at:at('2026-10-18T00:00:00'),end:at('2026-10-19T00:00:00'),due:at('2026-10-20T00:00:00')});
 expect(cohortOf(at('2026-10-18T23:59:00'),'week')).toEqual({at:at('2026-10-12T00:00:00'),end:at('2026-10-19T00:00:00'),due:at('2026-10-26T00:00:00')});
 expect(cohortOf(at('2026-01-31T23:59:00'),'month')).toEqual({at:at('2026-01-01T00:00:00'),end:at('2026-02-01T00:00:00'),due:at('2026-03-03T00:00:00')});
});
const cards=Array.from({length:12},(_,i)=>({id:100001+i,heat:1200-i,talkNum:0,registeredAt:1000+i,adult:i===0}));
it('settles clean and all independently without weighting clean works',()=>{
 const all=rankCohort(cards,'all'),clean=rankCohort(cards,'clean');
 expect(all).toHaveLength(10);expect(all[0]).toMatchObject({id:100001,rank:1,band:1});
 expect(clean).toHaveLength(10);expect(clean[0]).toMatchObject({id:100002,rank:1,band:1});
 expect(all.slice(1,3).map(x=>x.band)).toEqual([3,3]);expect(all.slice(3).every(x=>x.band===10)).toBe(true);
});
it('requires positive heat and awards only first when the board has fewer than ten entrants',()=>{
 expect(rankCohort(cards.slice(0,9),'all')).toHaveLength(1);
 expect(rankCohort(cards.map(x=>({...x,heat:0})),'all')).toEqual([]);
 // Only positive-heat cards count toward the ten-card threshold.
 expect(rankCohort(cards.slice(0,10).map((x,i)=>({...x,heat:i<3?50-i:0})),'all')).toHaveLength(1);
});
it('breaks heat ties deterministically by conversations, original publication time, then card number',()=>{
 const tied=cards.map(x=>({...x,heat:50,talkNum:1,registeredAt:100}));
 tied[0].talkNum=2;tied[1].registeredAt=101;
 expect(rankCohort(tied,'all').slice(0,3).map(x=>x.id)).toEqual([100001,100002,100012]);
});

it('uses the next Taipei day after the actual last entrant matures, including exact midnight',()=>{
 expect(cohortOf(at('2026-10-12T12:00:00'),'week').due).toBe(at('2026-10-20T00:00:00'));
 expect(cohortOf(at('2026-10-01T00:00:00'),'month').due).toBe(at('2026-11-01T00:00:00'));
});
it('switches heat to v2 for every period not yet settled when v2 ships, never inside one',()=>{
 // Day 11-18 and the week of 11-09 settle before v2 ships; 11-19, the week of 11-16 and November do not.
 expect(heatFormulaOf(at('2026-11-18T23:59:00'),'day')).toBeUndefined();
 expect(heatFormulaOf(at('2026-11-19T00:00:00'),'day')).toBe('v2');
 expect(heatFormulaOf(at('2026-11-15T23:59:00'),'week')).toBeUndefined();
 expect(heatFormulaOf(at('2026-11-16T00:00:00'),'week')).toBe('v2');
 // A card first published mid-week belongs to its Monday-start week.
 expect(heatFormulaOf(at('2026-11-18T12:00:00'),'week')).toBe('v2');
 expect(heatFormulaOf(at('2026-10-31T23:59:00'),'month')).toBeUndefined();
 expect(heatFormulaOf(at('2026-11-01T00:00:00'),'month')).toBe('v2');
 expect(heatFormulaOf(at('2026-11-30T23:59:00'),'month')).toBe('v2');
});
