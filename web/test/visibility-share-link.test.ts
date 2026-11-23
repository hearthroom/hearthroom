// 作者在「公開範圍」對話框複製卡片連結，也是分享了一張卡：新手七日「分享一張卡」要算到（PM 2026-11-23）。
// 剪貼簿拿不到、改成自己選字複製時一樣算。
import { afterEach, expect, it, vi } from 'vitest';
import { createApp,h,nextTick,type App } from 'vue';
import { i18n } from '../src/lib/i18n';
const noted=vi.hoisted(()=>vi.fn(async()=>undefined));
vi.mock('../src/lib/share-ref',()=>({noteShareLinkCreated:noted}));
import VisibilityPicker from '../src/components/VisibilityPicker.vue';
const linked={access:'unlisted',effectiveAccess:'link',review:'none',update:'none',everPublic:false,revisionState:'unknown',restorable:false,restoreReason:'no_approval',draftChanged:false,restriction:'none',policyRevision:'1',approvalRevision:'0',actions:['set_private','submit_review'],syncState:'complete'} as any;
let app:App,root:HTMLElement;afterEach(()=>{app?.unmount();root?.remove();vi.unstubAllGlobals();noted.mockClear();});
async function mount(){root=document.createElement('div');document.body.append(root);app=createApp({render:()=>h(VisibilityPicker,{value:linked,phase:'ready',shareUrl:'https://sukisuki.ai/cards/12',shareRole:'role-src'})}).use(i18n);app.mount(root);await nextTick();}
const copyButton=()=>root.querySelector<HTMLButtonElement>('.visibility-link button')!;
it('複製連結成功：記下產生了分享連結',async()=>{
 vi.stubGlobal('navigator',{...navigator,clipboard:{writeText:()=>Promise.resolve()}});
 await mount();copyButton().click();
 await vi.waitFor(()=>expect(noted).toHaveBeenCalledWith('role-src'));
});
it('剪貼簿拿不到、改成自己複製：照樣記下',async()=>{
 vi.stubGlobal('navigator',{...navigator,clipboard:{writeText:()=>Promise.reject(new Error('denied'))}});
 await mount();copyButton().click();
 await vi.waitFor(()=>expect(noted).toHaveBeenCalledWith('role-src'));
});
