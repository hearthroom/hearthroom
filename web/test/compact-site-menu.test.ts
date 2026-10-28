import { afterEach, expect, it, vi } from "vitest";
import { computed, createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import CompactSiteSections from "../src/components/CompactSiteSections.vue";
import { siteLinksKey } from "../src/lib/site-links";
let app: App, root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.unstubAllGlobals(); });
it("puts preferences before community, deduplicates destinations, and collapses low-frequency groups", async () => {
  vi.stubGlobal("fetch", async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  await router.push("/"); await router.isReady();
  root = document.createElement("div"); document.body.append(root);
  app = createApp(CompactSiteSections).use(createPinia()).use(router).use(i18n);
  app.provide(siteLinksKey, computed(() => ({ repoUrl: "https://example.test/repo", license: "AGPL", discordInvite: "https://discord.test", showDownloadEntry: true, canInstallSite: true, routeLine: { name: "routes.name.a", host: "example.test" } })));
  app.mount(root); await nextTick();
  const groups = [...root.querySelectorAll('[data-menu-section]')];
  expect(groups.map(g => g.getAttribute('data-menu-section'))).toEqual(['preferences', 'community', 'developers', 'support', 'legal']);
  expect(root.querySelector('details')?.open).toBe(false);
  const ids = [...root.querySelectorAll('[data-site-link]')].map(el => el.getAttribute('data-site-link'));
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain('download'); expect(ids).not.toContain('install');
  expect(root.querySelector('[data-menu-section="community"]')?.querySelectorAll('[data-site-link]').length).toBe(5);
  expect(root.querySelector('[data-menu-section="preferences"] [data-site-link="routes"]')?.textContent).toContain('example.test');
});

it('opens the ordinary pet menu after language without resetting position or enabling a disabled pet',async()=>{
 const {petMenuKey}=await import('../src/lib/site-links');const {petEnabled}=await import('../src/pet/enabled');
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<div/>'}}]});await router.push('/');
 const opener=document.createElement('button');document.body.append(opener);const events:Event[]=[];const listen=(e:Event)=>events.push(e);window.addEventListener('suki-menu',listen);
 root=document.createElement('div');document.body.append(root);app=createApp(CompactSiteSections,{opener:()=>opener}).use(createPinia()).use(router).use(i18n);app.provide(petMenuKey,computed(()=>true));app.mount(root);await nextTick();
 const buttons=[...root.querySelectorAll('[data-menu-section="preferences"] button')];expect(buttons[2]?.hasAttribute('data-pet-menu')).toBe(true);
 localStorage.setItem('suki.pet.pos','saved-position');petEnabled.value=true;(buttons[2] as HTMLButtonElement).click();await new Promise(r=>setTimeout(r,10));
 expect(events).toHaveLength(1);expect((events[0] as CustomEvent).detail).toBe(opener);expect(localStorage.getItem('suki.pet.pos')).toBe('saved-position');
 petEnabled.value=false;await nextTick();(buttons[2] as HTMLButtonElement).click();await new Promise(r=>setTimeout(r,10));expect(events).toHaveLength(1);expect(petEnabled.value).toBe(false);
 window.removeEventListener('suki-menu',listen);opener.remove();localStorage.removeItem('suki.pet.pos');petEnabled.value=true;await nextTick();
});
