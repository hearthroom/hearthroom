import {afterEach,describe,expect,it,vi} from 'vitest';
import {createApp,nextTick,type App} from 'vue';
import {createMemoryHistory,createRouter} from 'vue-router';
import {i18n} from '../src/lib/i18n';
import {ANDROID_BANNER_DISMISS_KEY,shouldShowAndroidBanner,shouldShowDownloadEntry} from '../src/lib/download';
import DownloadBanner from '../src/components/DownloadBanner.vue';

const UA={
 androidChrome:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
 androidApp:'Mozilla/5.0 (Linux; Android 15; wv) Chrome/133.0.0.0 Mobile Safari/537.36 HearthroomApp/1.0.9',
 iphone:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
 ipad:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
 mac:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
 windows:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
 linux:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
};

describe('只有 Android 瀏覽器才提示裝 Android App',()=>{
 it('Android 瀏覽器、沒裝、沒關過：提示',()=>{
  expect(shouldShowAndroidBanner({ua:UA.androidChrome,standalone:false,dismissed:false})).toBe(true);
 });
 it.each(['iphone','ipad','mac','windows','linux'] as const)('%s 不提示',k=>{
  expect(shouldShowAndroidBanner({ua:UA[k],standalone:false,dismissed:false})).toBe(false);
 });
 it('Android App 與已安裝的 PWA 裡不提示',()=>{
  expect(shouldShowAndroidBanner({ua:UA.androidChrome,standalone:true,dismissed:false})).toBe(false);
 });
 it('按過關閉就不再提示',()=>{
  expect(shouldShowAndroidBanner({ua:UA.androidChrome,standalone:false,dismissed:true})).toBe(false);
 });
});

let app:App|undefined;let el:HTMLElement|undefined;
afterEach(()=>{app?.unmount();el?.remove();vi.restoreAllMocks();localStorage.clear()});
async function mount(ua:string){
 vi.spyOn(navigator,'userAgent','get').mockReturnValue(ua);
 i18n.global.locale.value='zh-Hant' as never;
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:p(.*)*',component:{template:'<div/>'}}]});await router.push('/');await router.isReady();
 el=document.createElement('div');document.body.append(el);app=createApp(DownloadBanner).use(router).use(i18n);app.mount(el);await nextTick();
 return el;
}

describe('橫幅',()=>{
 it('Android 瀏覽器看得到，也有關閉鍵；按下去就收起來，重新載入也不再出現',async()=>{
  const root=await mount(UA.androidChrome);
  expect(root.querySelector('.download-banner')).not.toBeNull();
  const close=root.querySelector<HTMLButtonElement>('button.download-banner__close')!;
  expect(close.getAttribute('aria-label')).toBe(i18n.global.t('dialog.close'));
  close.click();await nextTick();
  expect(root.querySelector('.download-banner')).toBeNull();
  expect(localStorage.getItem(ANDROID_BANNER_DISMISS_KEY)).not.toBeNull();
  app?.unmount();el?.remove();
  const again=await mount(UA.androidChrome);
  expect(again.querySelector('.download-banner')).toBeNull();
 });
 it('iPhone 上不出現',async()=>{
  expect((await mount(UA.iphone)).querySelector('.download-banner')).toBeNull();
 });
 it('我們自己的 Android App 裡不出現',async()=>{
  expect((await mount(UA.androidApp)).querySelector('.download-banner')).toBeNull();
 });
});

describe('頁尾的「下載 App」入口',()=>{
 it.each(['androidChrome','mac','windows','linux'] as const)('%s 留著（電腦版的人也該知道有 Android App）',k=>{
  expect(shouldShowDownloadEntry({ua:UA[k],touchPoints:0})).toBe(true);
 });
 it('iPhone 不需要',()=>{expect(shouldShowDownloadEntry({ua:UA.iphone,touchPoints:5})).toBe(false)});
 it('iPad（桌面版 UA，靠觸控點認）不需要',()=>{expect(shouldShowDownloadEntry({ua:UA.ipad,touchPoints:5})).toBe(false)});
 it('我們自己的 Android App 裡不需要',()=>{expect(shouldShowDownloadEntry({ua:UA.androidApp,touchPoints:5})).toBe(false)});
});
