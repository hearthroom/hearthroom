import MarkdownIt from 'markdown-it';
import { decodeHTML } from 'entities';
import { REVIEW_REQUIRED_CHARACTERS, type ReviewLength } from '../shared/review-length';

const markdown = new MarkdownIt({html: false, linkify: false});
const graphemes = new Intl.Segmenter('und',{granularity:'grapheme'});
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
      if(end<0){parts.push(input.slice(open));break;}
      cursor=end;continue;
    }
    if(!/[a-z]/i.test(input[nameStart]??'')){parts.push('<');cursor=open+1;continue;}
    let nameEnd=nameStart+1;
    while(nameEnd<input.length&&/[a-z0-9:-]/i.test(input[nameEnd]))nameEnd++;
    if(nameEnd<input.length&&!/[\s/>]/.test(input[nameEnd])){parts.push('<');cursor=open+1;continue;}
    const end=endOfTag(nameEnd);
    if(end<0){parts.push(input.slice(open));break;}
    const name=lower.slice(nameStart,nameEnd);
    cursor=end;
    if(!closing&&(name==='script'||name==='style')){
      let close=lower.indexOf('</'+name,cursor);
      while(close>=0&&!/[\s>]/.test(input[close+name.length+2]??''))close=lower.indexOf('</'+name,close+2);
      if(close<0){cursor=input.length;continue;}
      const closeEnd=endOfTag(close+name.length+2);
      cursor=closeEnd<0?input.length:closeEnd;
    }
  }
  return parts.join('');
}

/** Strip markup before decoding so entity names and HTML attributes cannot inflate the count. */
export function effectiveCharacters(value: unknown): number {
  const plain = withoutVariables(withoutMarkup(text(value)));
  let count = 0;
  const countText = (s: string) => {
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

export function reviewLength(settings: Record<string, unknown>): ReviewLength {
  const persona = effectiveCharacters(record(settings.document).roleDetailDesc);
  const books = Array.isArray(settings.worldbooks) ? settings.worldbooks : settings.worldbook ? [settings.worldbook] : [];
  let constantWorldbook = 0;
  for (const book of books) {
    const entries = record(book).entries;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const e = record(entry);
      if (e.isEnabled !== false && e.isConstant === true) constantWorldbook += effectiveCharacters(e.content);
    }
  }
  const total = persona + constantWorldbook;
  return {persona, constantWorldbook, total, required: REVIEW_REQUIRED_CHARACTERS,
    remaining: Math.max(0, REVIEW_REQUIRED_CHARACTERS-total), eligible: total >= REVIEW_REQUIRED_CHARACTERS,
    welcome: effectiveCharacters(record(settings.greetings).welcome)};
}
