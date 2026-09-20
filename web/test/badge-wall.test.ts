import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createApp,nextTick,type App} from 'vue';
import {i18n,applyLocale} from '../src/lib/i18n';
import BadgeWall from '../src/components/BadgeWall.vue';
import type {CollectedBadge} from '../../shared/community-badges';
let app:App,el:HTMLDivElement;
const item=(key:string,state:CollectedBadge['state']='earned'):CollectedBadge=>({key,state,icon:'star',category:'event',titles:{en:'Summer traveler'},descriptions:{en:'Participate in the summer event.'},earnedAt:1000,expiresAt:null});
beforeEach(async()=>{el=document.createElement('div');document.body.append(el);await applyLocale('en');});
afterEach(()=>{app?.unmount();el.remove();});
it('renders icons, conditions and earned/locked states without showing internal keys',()=>{
 app=createApp(BadgeWall,{items:[item('event_summer'),{...item('community_level_5','locked'),progress:{value:1,target:250}}],selected:[],editable:true}).use(i18n);app.mount(el);
 expect(el.textContent).toContain('Participate in the summer event.');expect(el.textContent).toContain('Not yet earned');expect(el.textContent).not.toContain('event_summer');expect(el.querySelectorAll('svg')).toHaveLength(2);expect(el.querySelector('progress')?.value).toBe(1);
});
it('prevents a fourth featured badge while allowing deselection',async()=>{
 const change=vi.fn();app=createApp(BadgeWall,{items:['a','b','c','d'].map(k=>item(k)),selected:['a','b','c'],editable:true,onChange:change}).use(i18n);app.mount(el);
 const buttons=el.querySelectorAll('button[data-feature]');expect((buttons[3] as HTMLButtonElement).disabled).toBe(true);(buttons[0] as HTMLButtonElement).click();await nextTick();expect(change).toHaveBeenCalledWith(['b','c']);
});
it('keeps public walls read-only and safely renders event text',()=>{
 app=createApp(BadgeWall,{items:[{...item('event_custom'),titles:{en:'<img src=x onerror=alert(1)>'}}]}).use(i18n);app.mount(el);
 expect(el.querySelector('img')).toBeNull();expect(el.querySelector('[data-feature]')).toBeNull();expect(el.textContent).toContain('<img');
});
