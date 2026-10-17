import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, reactive, h, type App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n, applyLocale } from '../src/lib/i18n';
// Public appearance is ancillary to the explicit official prop. Keep this unit
// fixture local instead of leaving an actual HTTP request alive at teardown.
vi.mock('../src/lib/community', () => ({ communityRequest: async () => ({ members: { abcdefgh: { badges: [] } } }) }));
import CommunityName from '../src/components/CommunityName.vue';
import CardTile from '../src/components/CardTile.vue';
let app:App|undefined, el:HTMLDivElement;
afterEach(()=>{app?.unmount();el?.remove();});
const mount=(component:any, props:any, router?:any)=>{el=document.createElement('div');document.body.append(el);app=createApp({render:()=>h(component,props)}).use(i18n);if(router)app.use(router);app.mount(el);};
it('shows only the explicit official flag and follows all five UI languages',async()=>{
 const props=reactive({name:'Suki',official:false,supporter:false});mount(CommunityName,props);
 expect(el.querySelector('.official-badge')).toBeNull();props.official=true;await nextTick();
 for(const [locale,label] of [['zh-Hant','官方'],['zh-Hans','官方'],['en','Official'],['ja','公式'],['ko','공식']] as const){
  await applyLocale(locale);await nextTick();expect(el.querySelector('.official-badge')?.textContent).toBe(label);
  expect(el.querySelector('.community-name > span:first-child')?.textContent).toBe('Suki');
 }
 props.official=false;props.supporter=true;await nextTick();expect(el.querySelector('.official-badge')).toBeNull();expect(el.querySelector('.community-name__supporter')).not.toBeNull();
});
it('carries the server author flag into the home card without removing statistics or the author link',async()=>{
 await applyLocale('en');const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:locale(zh-Hans|en|ja|ko)?/:p(.*)*',component:{template:'<div />'}}]});await router.push('/en/');
 const card=reactive({id:'100001',roleId:'r',zone:'en',name:'A story',summary:'',tags:[],avatarUrl:null,backgroundUrl:null,author:{handle:'abcdefgh',accountNumId:1,name:'Suki',avatar:'',official:true},talkNum:199,trending:0});
 mount(CardTile,{card},router);await nextTick();expect(el.querySelector('.card__by .official-badge')?.textContent).toBe('Official');expect(el.querySelector('.card__by')?.getAttribute('href')).toBe('/en/authors/abcdefgh');expect(el.textContent).toContain('199');
 card.author.official=false;await nextTick();expect(el.querySelector('.official-badge')).toBeNull();
});
