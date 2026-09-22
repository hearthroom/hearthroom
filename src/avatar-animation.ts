/** Called only after Images.info has validated the raster format and dimensions. */
export function preservesOriginalAnimation(bytes: ArrayBuffer, format: string): boolean {
 const data = new Uint8Array(bytes);
 const view = new DataView(bytes);
 const tag = (offset:number, text:string) => [...text].every((c,i)=>data[offset+i]===c.charCodeAt(0));
 // Keep GIFs intact, including their timing, loop count and transparency.
 if(format==='image/gif')return tag(0,'GIF87a')||tag(0,'GIF89a');
 if(format==='image/webp')return data.length>=30&&tag(0,'RIFF')&&tag(8,'WEBP')&&tag(12,'VP8X')&&(data[20]&2)!==0;
 if(format!=='image/png'&&format!=='image/apng')return false;
 if(![137,80,78,71,13,10,26,10].every((v,i)=>data[i]===v))return false;
 // APNG uses PNG chunks. Walk chunk boundaries, never search compressed pixels
 // for the acTL string. Its animation control must precede the first IDAT.
 for(let offset=8;offset+12<=data.length;) {
  const length=view.getUint32(offset);
  if(length>data.length-offset-12)throw new Error('invalid PNG chunk');
  if(tag(offset+4,'acTL')) {
   if(length!==8||view.getUint32(offset+8)===0)throw new Error('invalid APNG control');
   return true;
  }
  if(tag(offset+4,'IDAT')||tag(offset+4,'IEND'))return false;
  offset+=length+12;
 }
 return false;
}
