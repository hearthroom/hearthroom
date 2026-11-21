export const replyOptions = {
  agency: ['coauthor', 'protect'],
  style: ['default', 'guided', 'card', 'custom'],
  perspective: ['card', 'first_user', 'second_user', 'third_limited', 'third_omniscient'],
  length: ['auto', 'recommended', 'target'],
  pace: ['natural', 'linger', 'advance'],
} as const;
export type ReplyAxis = keyof typeof replyOptions;
export const replyAxes = Object.keys(replyOptions) as ReplyAxis[];
export const replyPlatform: Record<ReplyAxis, string> = {agency:'coauthor',style:'default',perspective:'card',length:'auto',pace:'natural'};
export const replyLengthTargets = [200,300,400,500,600,800,1000,1200,1500,2000,2500,3000,4000,5000,7000,10000];
export const replyNote = (axis: ReplyAxis) => `${axis}Note`;
export function replyOption(axis:ReplyAxis, value:string|undefined) {
  if(axis==='style' && value==='vivid')return 'default';
  if(axis==='perspective' && value==='first_character')return 'card';
  return axis==='agency' ? ({assist:'protect',lines:'coauthor'} as Record<string,string>)[value??''] ?? value ?? '' : value ?? '';
}
export const replyKnownKeys = [...replyAxes,...replyAxes.map(replyNote),'customStyle','lengthTarget'];
export function replyIssues(values:Record<string,string>): {field:string; key:string; max?:number}[] {
  const issues:{field:string;key:string;max?:number}[]=[];
  for(const key of Object.keys(values)) {
    if(!replyKnownKeys.includes(key)) issues.push({field:key,key:'unknown.warn'});
  }
  for(const axis of replyAxes) {
    const option=replyOption(axis,values[axis]);
    if(values[axis]!==undefined && !(replyOptions[axis] as readonly string[]).includes(option)) issues.push({field:axis,key:'legacy.warn'});
    const note=values[replyNote(axis)];
    if(note!==undefined && !note.trim()) issues.push({field:replyNote(axis),key:'legacy.warn'});
    if(note && [...note].length>200) issues.push({field:replyNote(axis),key:'error.noteLong',max:200});
  }
  if(values.style==='custom' && !values.customStyle?.trim()) issues.push({field:'customStyle',key:'error.customStyleEmpty'});
  if(values.customStyle && [...values.customStyle].length>1000) issues.push({field:'customStyle',key:'error.customStyleLong',max:1000});
  if(values.customStyle!==undefined && values.style!=='custom') issues.push({field:'style',key:'legacy.warn'});
  if(values.length==='target' ? (!/^\+?\d+$/.test(values.lengthTarget??'') || !replyLengthTargets.includes(Number(values.lengthTarget))) : values.lengthTarget!==undefined) issues.push({field:'length',key:'legacy.warn'});
  return issues;
}
