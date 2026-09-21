import {beforeEach,afterEach,expect,it,vi} from "vitest";
import {createApp,nextTick,reactive,h,type App} from "vue";
import {i18n,applyLocale} from "../src/lib/i18n";
const api=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("../src/lib/community",()=>({communityRequest:api.request}));
import {clearAppearanceCache} from "../src/lib/community-appearance";
import CommunityBadges from "../src/components/CommunityBadges.vue";
import CommunityBadgeList from "../src/components/CommunityBadgeList.vue";
let app:App,el:HTMLDivElement;
const settle=async()=>{await nextTick();await new Promise(r=>setTimeout(r,0));};
beforeEach(async()=>{vi.resetAllMocks();clearAppearanceCache();el=document.createElement("div");document.body.append(el);await applyLocale("en");});
afterEach(()=>{app?.unmount();el.remove();});
it("renders public level zero and the linked badge without exposing XP or identity",async()=>{
 api.request.mockImplementation(async (path:string)=>path.includes("/members?")?{members:{"public-author":{badges:["discord_linked"],level:0}}}:{});
 app=createApp(CommunityBadges,{handle:"public-author"}).use(i18n);app.mount(el);await settle();
 expect(el.textContent).toContain("Level 0");expect(el.textContent).toContain("Discord connected");
 expect(el.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
 expect(el.querySelector('[data-icon="discord"]')).not.toBeNull();
});
it("clears the previous author's level and badges when switching to a private profile",async()=>{
 api.request.mockImplementation(async (path:string)=>path.includes("/members?")?{members:{first:{badges:["first_work"],level:5},second:{badges:[]}}}:{});
 const props=reactive({handle:"first"});app=createApp({render:()=>h(CommunityBadges,props)}).use(i18n);app.mount(el);await settle();
 expect(el.textContent).toContain("Level 5");props.handle="second";await settle();expect(el.textContent).toBe("");
});
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
