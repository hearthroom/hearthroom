import {afterEach,expect,it,vi} from 'vitest';
import {createApp,nextTick,type App} from 'vue';
import {createMemoryHistory,createRouter} from 'vue-router';
import {i18n} from '../src/lib/i18n';
import AuthorVisibility from '../src/components/AuthorVisibility.vue';
import {VisibilityError} from '../src/lib/work-visibility';
const mocks=vi.hoisted(()=>({read:vi.fn(),change:vi.fn()}));
vi.mock('../src/lib/work-visibility-capability',async()=>{const {ref}=await import('vue');return {useWorkVisibilityCapability:()=>ref(true)};});
vi.mock('../src/lib/share-ref',()=>({ownReferralCode:async()=>null,withShareRef:(url:string)=>url}));
vi.mock('../src/lib/work-visibility',async original=>({...await original<typeof import('../src/lib/work-visibility')>(),fetchWorkVisibility:mocks.read,changeWorkVisibility:mocks.change}));
let app:App,root:HTMLElement;
afterEach(()=>{app?.unmount();root?.remove();localStorage.clear();vi.clearAllMocks();});
const flush=async()=>{for(let n=0;n<12;n++)await nextTick();};
const linked={access:'unlisted',effectiveAccess:'link',review:'none',update:'none',everPublic:false,revisionState:'unchanged',restorable:false,restoreReason:'never_public',draftChanged:false,restriction:'none',policyRevision:'1',approvalRevision:'1',actions:['set_private','submit_public'],syncState:'complete'};

async function refusePrivate(error:VisibilityError){
 mocks.read.mockResolvedValue({workVisibility:linked});
 mocks.change.mockRejectedValue(error);
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<div />'}}]});await router.push('/mine');
 root=document.createElement('div');root.id='app';document.body.append(root);
 app=createApp(AuthorVisibility,{id:'source',provider:'harbor',actor:'22',name:'Synthetic card',token:async()=>'test-token'}).use(router).use(i18n);
 const view=app.mount(root) as unknown as {open:()=>Promise<void>};await flush();await view.open();await flush();
 document.querySelector<HTMLInputElement>('.visibility-dialog input[value="private"]')!.click();await nextTick();
 document.querySelector<HTMLButtonElement>('.visibility-dialog [data-visibility-apply]')!.click();await flush();
 expect(mocks.change).toHaveBeenCalledOnce();
 return document.querySelector('.visibility-dialog')!;
}

it('shows a refused change inside the open dialog instead of behind it',async()=>{
 const dialog=await refusePrivate(new VisibilityError(403,{error:'test_account_operation_not_allowed'}));
 expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(i18n.global.t('state.forbidden'));
 expect(root.querySelector('[role="alert"]')).toBeNull();
});

it('shows a conflicting change inside the open dialog instead of behind it',async()=>{
 const dialog=await refusePrivate(new VisibilityError(409,{error:'visibility_operation_conflict'}));
 expect(dialog.querySelector('.notice[role="status"]')?.textContent).toBe(i18n.global.t('visibility.conflict'));
 expect(root.querySelector('.notice[role="status"]')).toBeNull();
});
