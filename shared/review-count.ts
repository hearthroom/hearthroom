/**
 * 送審有效字數的算法。Worker 的送審檢查與編輯器的即時字數都呼叫這裡的同一份函式，
 * 作者在編輯器看到的數字就是送審時算的數字。
 *
 * 跟門檻與型別（review-length.ts）分成兩個檔：網頁到處都會用到型別與格式化，計數要帶 markdown-it，
 * 只有編輯器需要，放在一起會被打進每一頁的主包。
 *
 * Intl.Segmenter 延到第一次計數才建：舊瀏覽器沒有它，在匯入時就建會讓整個編輯器載不起來；
 * 呼叫端（編輯器）自己接住計數時的例外、不顯示字數。
 */
import MarkdownIt from 'markdown-it';
import { decodeHTML } from 'entities';
import { REVIEW_REQUIRED_CHARACTERS, type ReviewLength } from './review-length';

const markdown = new MarkdownIt({html: false, linkify: false});
let graphemes: Intl.Segmenter | undefined;
const emoji = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\u20e3]|\p{Emoji}\uFE0F/u;
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};

/**
 * Template variables ({{char}}, ${user}, {{getvar::mood}}) are short and sit on one line. A stray opener whose
 * closer is on a later line, or that holds another opener first, is literal text: pairing it with a distant
 * closer would drop every word in between. Next-occurrence lookups are cached so the scan stays linear.
 */
function withoutVariables(input:string):string{
  const nextOf=(token:string)=>{
    let at=-2;
    return (from:number)=>{ if(at!==-1&&at<from)at=input.indexOf(token,from); return at; };
  };
  const nextNewline=nextOf('\n'),nextBraces=nextOf('}}'),nextBrace=nextOf('}'),nextDouble=nextOf('{{'),nextDollar=nextOf('${');
  const parts:string[]=[];
  let cursor=0;
  for(let i=0;i<input.length;){
    const double=input.startsWith('{{',i);
    if(!double&&!input.startsWith('${',i)){i++;continue;}
    const end=double?nextBraces(i+2):nextBrace(i+2);
    if(end<0){i+=2;continue;}
    const before=(at:number)=>at>=0&&at<end;
    if(before(nextNewline(i+2))||before(nextDouble(i+2))||before(nextDollar(i+2))){i++;continue;}
    parts.push(input.slice(cursor,i));cursor=end+(double?2:1);i=cursor;
  }
  parts.push(input.slice(cursor));return parts.join('');
}

/**
 * Stands in for a dropped unclosed opener. It counts nothing and is not a tag start, but its '<' still stops an
 * earlier stray tag (`<cfg rule=… <script> … >`) from pairing with a later '>' when markup is stripped again.
 */
const KEEP_BOUNDARY='< ';

type Ranges=ReadonlyArray<readonly [number,number]>;

/**
 * Backtick code in raw Markdown: ``` / ~~~ fences (an unclosed fence runs to the end, as in CommonMark) and inline
 * spans (a run of N backticks closed by the next run of exactly N in the same block). Authors quote <script>,
 * <style> and <!-- there as examples, so inside these ranges those openers do not start an excluded section.
 */
function backtickRanges(input:string):Ranges{
  const ranges:[number,number][]=[];
  const runs:{at:number;len:number;para:number}[]=[];
  let para=0,fence:{ch:string;len:number;start:number}|null=null;
  for(let start=0;start<=input.length;){
    let end=input.indexOf('\n',start);
    if(end<0)end=input.length;
    const line=input.slice(start,end);
    if(fence){
      const close=/^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if(close&&close[1][0]===fence.ch&&close[1].length>=fence.len){ranges.push([fence.start,end]);fence=null;para++;}
    }else{
      const open=/^ {0,3}(`{3,}|~{3,})/.exec(line);
      if(open&&!(open[1][0]==='`'&&line.indexOf('`',open[0].length)>=0)){fence={ch:open[1][0],len:open[1].length,start};para++;}
      else if(!line.trim())para++;
      else{
        // A list item, heading or block quote starts a new block, and a heading is only one line, so a lone
        // backtick cannot pair across them.
        const heading=/^ {0,3}#{1,6}(?: |$)/.test(line);
        if(heading||/^ {0,3}([-*+] |\d{1,9}[.)] |>)/.test(line))para++;
        for(let i=line.indexOf('`');i>=0;){
          let j=i;
          while(line[j]==='`')j++;
          if(line[i-1]!=='\\')runs.push({at:start+i,len:j-i,para});
          i=line.indexOf('`',j);
        }
        if(heading)para++;
      }
    }
    start=end+1;
  }
  if(fence)ranges.push([fence.start,input.length]);
  // Next run of the same length in the same block, built right to left so matching stays linear.
  const next=new Array<number>(runs.length).fill(-1);
  const last=new Map<number,number>();
  for(let k=runs.length-1;k>=0;k--){
    if(k<runs.length-1&&runs[k+1].para!==runs[k].para)last.clear();
    next[k]=last.get(runs[k].len)??-1;
    last.set(runs[k].len,k);
  }
  for(let k=0;k<runs.length;){
    const m=next[k];
    if(m<0){k++;continue;}
    ranges.push([runs[k].at,runs[m].at+runs[m].len]);
    k=m+1;
  }
  return ranges.sort((a,b)=>a[0]-b[0]);
}

/** Single forward scan: malformed or unterminated tags must not trigger regexp backtracking. */
function withoutMarkup(input:string,code:Ranges=[]):string{
  const parts:string[]=[];
  // ASCII folding preserves offsets even when the document contains expanding Unicode case folds.
  const lower=input.replace(/[A-Z]/g,ch=>ch.toLowerCase());
  const endOfTag=(start:number):number=>{
    let quote='';
    for(let i=start;i<input.length;i++){
      const ch=input[i];
      if(quote){if(ch===quote)quote='';}
      else if(ch==='"'||ch==="'")quote=ch;
      // An unclosed opener must not borrow the closing bracket of a later tag.
      else if(ch==='<')return -2;
      else if(ch==='>')return i+1;
    }
    return -1;
  };
  // Once a closer is missing from some point on, it is missing from every later point; remember that so
  // repeated unclosed openers do not rescan the tail.
  const unclosed=new Set<string>();
  // Openers are visited in increasing order, so one pointer walks the sorted code ranges.
  let range=0;
  const inCode=(at:number)=>{
    while(range<code.length&&code[range][1]<=at)range++;
    return range<code.length&&code[range][0]<=at;
  };
  let cursor=0;
  while(cursor<input.length){
    const open=input.indexOf('<',cursor);
    if(open<0){parts.push(input.slice(cursor));break;}
    parts.push(input.slice(cursor,open));
    if(input.startsWith('<!--',open)){
      // An unclosed or quoted comment opener is a mention, not a comment: drop the opener and keep counting.
      const close=unclosed.has('-->')||inCode(open)?-1:input.indexOf('-->',open+4);
      if(close<0){if(!inCode(open))unclosed.add('-->');parts.push(KEEP_BOUNDARY);cursor=open+4;continue;}
      cursor=close+3;continue;
    }
    let nameStart=open+1;
    const closing=input[nameStart]==='/';
    if(closing)nameStart++;
    if(input[nameStart]==='!'||input[nameStart]==='?'){
      const end=endOfTag(nameStart+1);
      if(end===-2){parts.push('<');cursor=open+1;continue;}
      if(end<0){parts.push(input.slice(open));break;}
      cursor=end;continue;
    }
    if(!/[a-z]/i.test(input[nameStart]??'')){parts.push('<');cursor=open+1;continue;}
    let nameEnd=nameStart+1;
    while(nameEnd<input.length&&/[a-z0-9:-]/i.test(input[nameEnd]))nameEnd++;
    if(nameEnd<input.length&&!/[\s/>]/.test(input[nameEnd])){parts.push('<');cursor=open+1;continue;}
    const end=endOfTag(nameEnd);
    // Resume at the next opener, but stop scanning a truly unterminated tail once.
    if(end===-2){parts.push('<');cursor=open+1;continue;}
    if(end<0){parts.push(input.slice(open));break;}
    const name=lower.slice(nameStart,nameEnd);
    cursor=end;
    if(!closing&&(name==='script'||name==='style')){
      // Quoted in backticks it is an example tag, not a script or stylesheet.
      if(inCode(open)){parts.push(KEEP_BOUNDARY);continue;}
      let close=unclosed.has(name)?-1:lower.indexOf('</'+name,cursor);
      while(close>=0&&!/[\s>]/.test(input[close+name.length+2]??''))close=lower.indexOf('</'+name,close+2);
      // No closer: the opener is a mention in prose, so only the tag itself is dropped.
      if(close<0){unclosed.add(name);parts.push(KEEP_BOUNDARY);continue;}
      const closeEnd=endOfTag(close+name.length+2);
      cursor=closeEnd===-2?close+name.length+2:closeEnd<0?input.length:closeEnd;
    }
  }
  return parts.join('');
}

/** Strip markup before decoding so entity names and HTML attributes cannot inflate the count. */
export function effectiveCharacters(value: unknown): number {
  const raw = text(value);
  const plain = withoutVariables(withoutMarkup(raw, backtickRanges(raw)));
  let count = 0;
  const countText = (s: string, code: Ranges = []) => {
    graphemes ??= new Intl.Segmenter('und',{granularity:'grapheme'});
    for(const {segment} of graphemes.segment(withoutVariables(withoutMarkup(s, code)).normalize('NFC'))){
      if(emoji.test(segment))continue;
      for(const ch of segment)if(/[\p{L}\p{N}]/u.test(ch))count++;
    }
  };
  for (const token of markdown.parse(plain, {})) {
    if (token.type === 'inline') {
      let content='';
      const code:[number,number][]=[];
      for (const child of token.children ?? []) {
        if (child.type === 'text') content+=child.content; // Markdown already decoded entities once.
        else if (child.type === 'softbreak' || child.type === 'hardbreak') content+='\n'; // keeps a stray opener from pairing across lines
        else if (child.type === 'code_inline') {
          const decoded=decodeHTML(child.content);
          code.push([content.length,content.length+decoded.length]);
          content+=decoded;
        }
        // image alt text, URLs, delimiter tokens and all markup are excluded.
      }
      countText(content, code);
    } else if (token.type === 'fence') {
      const decoded=decodeHTML(token.content);
      countText(decoded, [[0,decoded.length]]);
    } else if (token.type === 'code_block') countText(decodeHTML(token.content));
  }
  return count;
}

export type WorldbookCharacterCounts = {
  total: number;
  constant: number;
};

export function worldbookCharacters(
  settings: Record<string, unknown>,
  options?: { constantOnly?: boolean },
): WorldbookCharacterCounts {
  const constantOnly = options?.constantOnly === true;
  const books = Array.isArray(settings.worldbooks) ? settings.worldbooks : settings.worldbook ? [settings.worldbook] : [];
  let total = 0;
  let constant = 0;
  for (const book of books) {
    const entries = record(book).entries;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const e = record(entry);
      if (e.isEnabled === false) continue;
      if (constantOnly && e.isConstant !== true) continue;
      const chars = effectiveCharacters(e.content);
      total += chars;
      if (e.isConstant === true) constant += chars;
    }
  }
  return {total, constant};
}

export function reviewLength(settings: Record<string, unknown>): ReviewLength {
  const persona = effectiveCharacters(record(settings.document).roleDetailDesc);
  const constantWorldbook = worldbookCharacters(settings, {constantOnly: true}).constant;
  const total = persona + constantWorldbook;
  return {persona, constantWorldbook, total, required: REVIEW_REQUIRED_CHARACTERS,
    remaining: Math.max(0, REVIEW_REQUIRED_CHARACTERS-total), eligible: total >= REVIEW_REQUIRED_CHARACTERS,
    welcome: effectiveCharacters(record(settings.greetings).welcome)};
}
