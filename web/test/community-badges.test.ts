import {beforeEach,afterEach,expect,it,vi} from "vitest";
import {createApp,nextTick,reactive,h,type App} from "vue";
import {i18n,applyLocale} from "../src/lib/i18n";
const api=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("../src/lib/community",()=>({communityRequest:api.request}));
import {clearAppearanceCache} from "../src/lib/community-appearance";
import CommunityBadgeList from "../src/components/CommunityBadgeList.vue";
let app:App,el:HTMLDivElement;
const settle=async()=>{await nextTick();await new Promise(r=>setTimeout(r,0));};
beforeEach(async()=>{vi.resetAllMocks();clearAppearanceCache();el=document.createElement("div");document.body.append(el);await applyLocale("en");});
afterEach(()=>{app?.unmount();el.remove();});
it("gives level zero and every level tier an icon while keeping the exact level visible",async()=>{
 const props=reactive({badges:[] as string[],level:0});
 app=createApp({render:()=>h(CommunityBadgeList,props)}).use(i18n);app.mount(el);
 for(const [level,icon] of [[0,"spark"],[1,"flame"],[4,"flame"],[5,"lantern"],[9,"lantern"],[10,"star"],[19,"star"],[20,"crown"],[1000,"crown"]] as const){
  props.level=level;await nextTick();expect(el.textContent).toBe(`Level ${level}`);
  expect(el.querySelector('svg')?.getAttribute('data-icon')).toBe(icon);
  expect(el.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
 }
});
it("omits unknown badges and invalid levels instead of displaying raw keys",async()=>{
 app=createApp(CommunityBadgeList,{badges:["unknown_future_badge"],level:NaN}).use(i18n);app.mount(el);await settle();
 expect(el.textContent).toBe("");expect(el.querySelector('svg')).toBeNull();
});
it("draws a featured board honor as the colored badge with its full name, the same as everywhere else",async()=>{
 const items=[{key:"rank_clean_day_1",icon:"award",category:"rank",titles:{en:"server title"},descriptions:{en:""},state:"earned",earnedAt:1,expiresAt:null}];
 app=createApp(CommunityBadgeList,{badges:["rank_clean_day_1"],items}).use(i18n);app.mount(el);await settle();
 expect(el.querySelector(".rank-badge")).not.toBeNull();
 expect(el.querySelector('[data-icon="award"]')).toBeNull();
 expect(el.textContent).toContain("SFW Daily #1");
});
