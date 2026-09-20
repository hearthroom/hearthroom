import {beforeEach,afterEach,expect,it,vi} from "vitest";
import {createApp,nextTick,reactive,h,type App} from "vue";
import {i18n,applyLocale} from "../src/lib/i18n";
const api=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("../src/lib/community",()=>({communityRequest:api.request}));
import CommunityBadges from "../src/components/CommunityBadges.vue";
let app:App,el:HTMLDivElement;
const settle=async()=>{await nextTick();await new Promise(r=>setTimeout(r,0));};
beforeEach(async()=>{vi.resetAllMocks();el=document.createElement("div");document.body.append(el);await applyLocale("en");});
afterEach(()=>{app?.unmount();el.remove();});
it("renders public level zero and the linked badge without exposing XP or identity",async()=>{
 api.request.mockResolvedValue({badges:["discord_linked"],level:0});
 app=createApp(CommunityBadges,{handle:"public-author"}).use(i18n);app.mount(el);await settle();
 expect(el.textContent).toContain("Level 0");expect(el.textContent).toContain("Discord connected");
});
it("clears the previous author's level and badges when switching to a private profile",async()=>{
 api.request.mockResolvedValueOnce({badges:["first_work"],level:5}).mockResolvedValueOnce({badges:[]});
 const props=reactive({handle:"first"});app=createApp({render:()=>h(CommunityBadges,props)}).use(i18n);app.mount(el);await settle();
 expect(el.textContent).toContain("Level 5");props.handle="second";await settle();expect(el.textContent).toBe("");
});
