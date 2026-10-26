import {blogDescription} from "../../../shared/blog-text";
import { PRIMARY_HOST } from '../../../shared/site-hosts';
import { siteName } from '../../../shared/site-name';
import type { BlogPost, TranslationBrief } from './blog';
const origin=`https://${PRIMARY_HOST}`;
export const articleUrl=(p:{locale:string;columnSlug:string;slug:string})=>`${origin}${p.locale==='zh-Hant'?'':`/${p.locale}`}/blog/${encodeURIComponent(p.columnSlug)}/${encodeURIComponent(p.slug)}`;
export function clearArticleMeta(preserveAlternates=false){
 document.head.querySelectorAll('link[rel=canonical],link[hreflang],meta[property^="article:"],script[data-blog-meta],script[type="application/ld+json"],meta[property^="og:"],meta[name^="twitter:"]').forEach(e=>{if(!preserveAlternates||!e.matches('link[hreflang]:not([data-blog-meta])'))e.remove();});
 document.head.querySelector('meta[name=description]')?.setAttribute('content','');
}
export function setArticleMeta(p:BlogPost,versions:TranslationBrief[]){
 clearArticleMeta();document.documentElement.lang=p.locale;
 const link=(rel:string,href:string,lang?:string)=>{const e=document.createElement('link');e.rel=rel;e.href=href;e.dataset.blogMeta='1';if(lang){e.hreflang=lang;e.dataset.hreflang='1';}document.head.append(e);};
 const title=p.shareTitle||p.title,description=blogDescription(p);
 const url=articleUrl(p),image=p.shareCoverUrl||p.coverUrl||`${origin}/og/default-${p.locale}.jpg?v=3`;
 link('canonical',url);
 for(const v of versions)link('alternate',v.canonicalUrl,v.locale);
 if(versions.length)link('alternate',(versions.find(v=>v.locale===p.sourceLocale)??versions[0]!).canonicalUrl,'x-default');
 const meta=(key:string,value:string,property=true)=>{const e=document.createElement('meta');e.setAttribute(property?'property':'name',key);e.content=value;document.head.append(e);};
 meta('og:type','article');meta('og:title',title);meta('og:description',description);meta('og:url',url);meta('og:image',new URL(image,origin).href);
 meta('og:locale',({'zh-Hant':'zh_TW','zh-Hans':'zh_CN',en:'en_US',ja:'ja_JP',ko:'ko_KR'}as Record<string,string>)[p.locale]??'en_US');
 meta('twitter:card','summary_large_image',false);meta('twitter:title',title,false);meta('twitter:description',description,false);meta('twitter:image',new URL(image,origin).href,false);
 const published=new Date(p.firstPublishedAt??p.publishAt??p.createdAt).toISOString(),modified=new Date(p.contentUpdatedAt).toISOString();
 meta('article:published_time',published);meta('article:modified_time',modified);
 let desc=document.head.querySelector<HTMLMetaElement>('meta[name=description]');if(!desc){desc=document.createElement('meta');desc.name='description';document.head.append(desc);}desc.content=description;
 const ld=document.createElement('script');ld.type='application/ld+json';ld.dataset.blogMeta='1';ld.textContent=JSON.stringify({'@context':'https://schema.org','@type':'Article',headline:title,datePublished:published,dateModified:modified,image:[new URL(image,origin).href],author:{'@type':'Organization',name:siteName(p.locale)},mainEntityOfPage:url});document.head.append(ld);
}
