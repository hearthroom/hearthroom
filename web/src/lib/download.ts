import {PRIMARY_HOST,siteRootOf} from '../../../shared/site-hosts';

/** Keep official downloads in the visitor's domain family. */
export const androidDownloadUrl=(hostname:string=location.hostname):string=>
  `https://downloads.${siteRootOf(hostname) ?? PRIMARY_HOST}/latest.apk`;
