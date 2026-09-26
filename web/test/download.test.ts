import {afterEach,expect,it} from 'vitest';
import {createApp,nextTick,type App} from 'vue';
import {createMemoryHistory,createRouter} from 'vue-router';
import {i18n} from '../src/lib/i18n';
import {androidDownloadUrl} from '../src/lib/download';
import {PRIMARY_HOST} from '../../shared/site-hosts';
import DownloadPage from '../src/pages/DownloadPage.vue';
let app:App|undefined;let el:HTMLElement|undefined;
afterEach(()=>{app?.unmount();el?.remove()});
it.each(['hearthroom.club','sukisuki.ai','sukisuki.chat'])('keeps downloads in the %s domain family',host=>{
 expect(androidDownloadUrl(host)).toBe(`https://downloads.${host}/latest.apk`);
 expect(androidDownloadUrl(`www.${host}`)).toBe(`https://downloads.${host}/latest.apk`);
});
it('does not derive a download host from untrusted hosts',()=>{
 for(const host of ['localhost','sukisuki.ai.evil.test','evil.test'])expect(androidDownloadUrl(host)).toBe(`https://downloads.${PRIMARY_HOST}/latest.apk`);
});
it.each(['zh-Hant','zh-Hans','en','ja','ko'])('offers the APK and installation instructions in %s without login',async locale=>{
 i18n.global.locale.value=locale as never;
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/download',component:DownloadPage}]});await router.push('/download');await router.isReady();
 el=document.createElement('div');document.body.append(el);app=createApp(DownloadPage).use(router).use(i18n);app.mount(el);await nextTick();
 expect(el.querySelector(`a[href="https://downloads.${PRIMARY_HOST}/latest.apk"]`)?.textContent).toContain(i18n.global.t('download.android'));
 expect(el.querySelectorAll('ol li')).toHaveLength(3);
 expect(el.textContent).toContain(i18n.global.t('download.updates'));
 expect(el.textContent).not.toMatch(/download\.[a-z]/);
});
