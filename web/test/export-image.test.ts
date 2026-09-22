import {afterEach,expect,it,vi} from 'vitest';
import {imageToPng} from '../src/lib/export-image';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('preserves PNG bytes including animation chunks',async()=>{
 const png=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
 expect(await imageToPng(png)).toBe(png);
});
it('decodes non-PNG portraits and encodes at the original dimensions',async()=>{
 const close=vi.fn();const bitmap={width:480,height:720,close};const drawImage=vi.fn();
 vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage} as any);
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(function(this:HTMLCanvasElement,cb){
   expect([this.width,this.height]).toEqual([480,720]);cb(new Blob([new Uint8Array([137,80,78,71])]));
 });
 const input=new Uint8Array([255,216,255]);
 expect(await imageToPng(input)).toEqual(new Uint8Array([137,80,78,71]));
 expect(drawImage).toHaveBeenCalledWith(bitmap,0,0);expect(close).toHaveBeenCalledOnce();
});
