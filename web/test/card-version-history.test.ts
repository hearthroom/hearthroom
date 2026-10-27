import {afterEach,expect,it,vi} from 'vitest';
import {createApp,h,nextTick,reactive,type App} from 'vue';
import {i18n} from '../src/lib/i18n';
const mock=vi.hoisted(()=>({load:vi.fn()}));
vi.mock('../src/lib/api',()=>({fetchCardVersions:mock.load}));
import CardVersionHistory from '../src/components/CardVersionHistory.vue';
let app:App;
const settle=async()=>{for(let i=0;i<4;i++){await nextTick();await Promise.resolve();}};
const revision=(id:string,kind='minor',source='published')=>({versionId:id,updateKind:kind,updateNote:kind==='major'?'<b>新增支線</b>':'',publishedAt:source==='unknown'?null:1793080800000,publicationTimeSource:source});
afterEach(()=>{app?.unmount();document.body.innerHTML='';mock.load.mockReset();});
function mount(props:{cardId:string;target?:string}){const root=document.createElement('div');document.body.append(root);app=createApp({render:()=>h(CardVersionHistory,props)});app.use(i18n);app.mount(root);return root;}
it('keeps the latest silent record current and targets a historical changelog beyond page one as text',async()=>{
 mock.load.mockResolvedValue({items:[revision('latest'),revision('older')],page:1,hasMore:true,target:revision('target','major','review')});
 const root=mount({cardId:'100001',target:'target'});await settle();
 expect(mock.load).toHaveBeenCalledWith('100001',1,'target');
 expect(root.querySelector('[data-current-version]')?.textContent).not.toContain('新增支線');
 const target=root.querySelector<HTMLDetailsElement>('[data-version-id="target"]');expect(target?.open).toBe(true);
 expect(target?.textContent).toContain('<b>新增支線</b>');expect(target?.querySelector('b')).toBeNull();
 expect(target?.textContent).toContain('審核通過');expect(target?.textContent).toContain('未記錄公開時間');
});
it('keeps loaded records on a more-page error and allows retry',async()=>{
 mock.load.mockResolvedValueOnce({items:[revision('latest','major'),revision('old')],page:1,hasMore:true}).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({items:[revision('next','minor','unknown')],page:2,hasMore:false});
 const root=mount({cardId:'100001'});await settle();
 root.querySelector<HTMLButtonElement>('[data-history-toggle]')!.click();await settle();
 root.querySelector<HTMLButtonElement>('[data-history-more]')!.click();await settle();
 expect(root.querySelector('[data-current-version]')?.textContent).toContain('<b>新增支線</b>');
 expect(root.textContent).toContain('較早的版本記錄暫時無法載入');
 root.querySelector<HTMLButtonElement>('[data-history-more]')!.click();await settle();
 expect(root.textContent).toContain('日期未記錄');expect(root.textContent).not.toContain('1970');
});
it('discards a late response from the previous card',async()=>{
 let release!:(v:unknown)=>void;
 mock.load.mockReturnValueOnce(new Promise(r=>{release=r;})).mockResolvedValueOnce({items:[revision('new','major')],page:1,hasMore:false});
 const props=reactive({cardId:'old'});const root=mount(props);await settle();props.cardId='new';await settle();
 release({items:[{...revision('old','major'),updateNote:'DO NOT SHOW'}],page:1,hasMore:false});await settle();
 expect(root.textContent).not.toContain('DO NOT SHOW');
});
