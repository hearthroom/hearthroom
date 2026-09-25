import {PRIMARY_HOST,siteRootOf} from '../../../shared/site-hosts';

/** Keep official downloads in the visitor's domain family. */
export const androidDownloadUrl=(hostname:string=location.hostname):string=>
  `https://downloads.${siteRootOf(hostname) ?? PRIMARY_HOST}/latest.apk`;

/*
  「裝 Android App」橫幅只對 Android 瀏覽器有意義：iOS、macOS、Windows、Linux 裝不了 APK；
  已經在 App 裡（UA 帶 HearthroomApp）或已安裝的 PWA 視窗裡，再叫人裝一次也沒意義（owner 2026-09-25）。
  Android 上不想裝的人按 ✕ 關掉，這個瀏覽器之後就不再出現；想裝的人頁尾還有「下載 App」。
*/
export const ANDROID_BANNER_DISMISS_KEY='hearthroom.androidBanner.dismissedAt';

export const isAndroidBrowser=(ua:string):boolean=>/\bAndroid\b/i.test(ua);

export function shouldShowAndroidBanner(input:{ua:string;standalone:boolean;dismissed:boolean}):boolean{
  return isAndroidBrowser(input.ua)&&!input.standalone&&!input.dismissed;
}

export function readAndroidBannerDismissed():boolean{
  try{return localStorage.getItem(ANDROID_BANNER_DISMISS_KEY)!=null}catch{return false}
}

export function dismissAndroidBanner():void{
  try{localStorage.setItem(ANDROID_BANNER_DISMISS_KEY,String(Date.now()))}catch{/* 存不了：這次先收起來，下次再問 */}
}

/*
  頁尾的「下載 App」入口：電腦版（Windows、Mac、Linux）的人透過這裡知道有 Android App——
  不在首頁頂端推，電腦不是從那個位置轉化的（owner 2026-09-25）。iOS 裝不了 APK；已經在我們的
  App 裡也不需要。iPadOS 用桌面版 UA，靠觸控點數認。
*/
export function shouldShowDownloadEntry(input:{ua:string;touchPoints:number}):boolean{
  const {ua,touchPoints}=input;
  if(/\bHearthroomApp\/[\d.]+\b/.test(ua))return false;
  if(/iPhone|iPad|iPod/.test(ua))return false;
  if(/Macintosh/.test(ua)&&touchPoints>1)return false;
  return true;
}
