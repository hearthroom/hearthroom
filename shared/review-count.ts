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

function withoutVariables(input:string):string{
  const parts:string[]=[];
  let cursor=0;
  for(let i=0;i<input.length;){
    const close=input.startsWith('{{',i)?'}}':input.startsWith('${',i)?'}':null;
    if(!close){i++;continue;}
    const end=input.indexOf(close,i+2);
    if(end<0)break;
    parts.push(input.slice(cursor,i));cursor=end+close.length;i=cursor;
  }
  parts.push(input.slice(cursor));return parts.join('');
}

/** Single forward scan: malformed or unterminated tags must not trigger regexp backtracking. */
function withoutMarkup(input:string):string{
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
  let cursor=0;
  while(cursor<input.length){
    const open=input.indexOf('<',cursor);
    if(open<0){parts.push(input.slice(cursor));break;}
    parts.push(input.slice(cursor,open));
    if(input.startsWith('<!--',open)){
      const close=input.indexOf('-->',open+4);
      cursor=close<0?input.length:close+3;continue;
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
      let close=lower.indexOf('</'+name,cursor);
      while(close>=0&&!/[\s>]/.test(input[close+name.length+2]??''))close=lower.indexOf('</'+name,close+2);
      if(close<0){cursor=input.length;continue;}
      const closeEnd=endOfTag(close+name.length+2);
      cursor=closeEnd===-2?close+name.length+2:closeEnd<0?input.length:closeEnd;
    }
  }
  return parts.join('');
}

/** Strip markup before decoding so entity names and HTML attributes cannot inflate the count. */
export function effectiveCharacters(value: unknown): number {
  const plain = withoutVariables(withoutMarkup(text(value)));
  let count = 0;
  const countText = (s: string) => {
    graphemes ??= new Intl.Segmenter('und',{granularity:'grapheme'});
    for(const {segment} of graphemes.segment(withoutVariables(withoutMarkup(s)).normalize('NFC'))){
      if(emoji.test(segment))continue;
      for(const ch of segment)if(/[\p{L}\p{N}]/u.test(ch))count++;
    }
  };
  for (const token of markdown.parse(plain, {})) {
    if (token.type === 'inline') {
      let content='';
      for (const child of token.children ?? []) {
        if (child.type === 'text') content+=child.content; // Markdown already decoded entities once.
        else if (child.type === 'code_inline') content+=decodeHTML(child.content);
        // image alt text, URLs, delimiter tokens and all markup are excluded.
      }
      countText(content);
    } else if (token.type === 'code_block' || token.type === 'fence') countText(decodeHTML(token.content));
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
