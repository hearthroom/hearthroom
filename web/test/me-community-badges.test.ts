import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {createApp,nextTick,type App} from "vue";
import {createMemoryHistory,createRouter} from "vue-router";
import {i18n,applyLocale} from "../src/lib/i18n";
const mock=vi.hoisted(()=>({request:vi.fn(),confirm:vi.fn(async()=>true)}));
vi.mock("../src/lib/community",async original=>({...await original<object>(),communityRequest:mock.request}));
vi.mock("../src/lib/confirm",()=>({confirmDialog:mock.confirm}));
vi.mock("../src/lib/session",()=>({useSession:()=>({me:{},displayName:"Fixture",avatarUrl:"",profile:{handle:"fixture",memberSince:0},accessToken:async()=>"fixture"})}));
vi.mock("../src/lib/review",()=>({useReviewer:()=>({reviewer:false})}));
vi.mock("../src/components/CommunityProfile.vue",()=>({default:{template:"<div />"}}));
vi.mock("../src/components/ConnectedAccounts.vue",()=>({default:{template:"<div />"}}));
import MePage from "../src/pages/MePage.vue";
let app:App,el:HTMLDivElement;
const view={enabled:true,invite:"https://discord.gg/fixture",link:{name:"Linked",state:"synced"},xp:1,level:0,badges:["discord_linked","first_work"],xpEnabled:true,preferences:{public_badges:0,public_level:0,notifications:0,discord_dm:0,case_access:0}};
beforeEach(async()=>{
 vi.clearAllMocks();await applyLocale("en");
 mock.request.mockImplementation(async(_path:string,_token:string,method:string)=>method==="DELETE"?{...view,link:null,badges:["first_work"]}:view);
 const router=createRouter({history:createMemoryHistory(),routes:[{path:"/:pathMatch(.*)*",component:MePage}]});await router.push("/me");
 el=document.createElement("div");document.body.append(el);app=createApp(MePage).use(router).use(i18n);app.mount(el);
 await nextTick();await new Promise(r=>setTimeout(r,0));
});
afterEach(()=>{app?.unmount();el.remove();});
it("shows own level and badge icons in the profile header even when public visibility is off",()=>{
 const header=el.querySelector(".me__who")!;
 expect(header.textContent).toContain("Level 0");expect(header.textContent).toContain("Discord connected");
 expect(header.querySelectorAll(".community-badges svg")).toHaveLength(3);
 expect(el.querySelector('a[href="https://discord.gg/fixture"] svg')).not.toBeNull();
 expect(mock.request.mock.calls.some(c=>c[0].startsWith("/community/members/"))).toBe(false);
});
it("clears linked level and badge immediately after unlink while retaining earned achievements",async()=>{
 const button=[...el.querySelectorAll("button")].find(b=>b.textContent.trim()===i18n.global.t("community.unlink"))!;
 button.click();await nextTick();await new Promise(r=>setTimeout(r,0));
 const header=el.querySelector(".me__who")!;
 expect(header.textContent).not.toContain("Level 0");expect(header.textContent).not.toContain("Discord connected");
 expect(header.textContent).toContain(i18n.global.t("community.badges.first_work"));
});
