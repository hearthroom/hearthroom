import {HttpError} from './types';
import {bumpOp} from './ops-metrics';

export const COUNTRY_REGIONS = ['HK','MO','TW','SG','MY','CN','JP','KR','US','OTHER'] as const;
export type CountryRegion = typeof COUNTRY_REGIONS[number];
export function defaultCountryRegion(country:string,locale:string):CountryRegion {
 const code=country.toUpperCase();
 if(['HK','MO','TW','SG','MY','JP','KR','US'].includes(code))return code as CountryRegion;
 return /^zh(?:-|$)/i.test(locale)?'TW':'OTHER';
}
/** The caller supplies the UI language; IP only selects one of the supported default regions. */
export function countryRegionDefaults(req:{header:(name:string)=>string|undefined;url?:string;raw?:Request}):{country:string;locale:string}{
 return {country:String(req.raw?.cf?.country || req.header('CF-IPCountry') || ''),locale:req.header('language') || (req.url?new URL(req.url).searchParams.get('lang'):null) || req.header('Accept-Language')?.split(',')[0] || 'zh'};
}
export function parseCountryRegion(value:unknown):CountryRegion {
 if(typeof value!=='string'||!(COUNTRY_REGIONS as readonly string[]).includes(value))throw new HttpError(400,'countryRegion_invalid');
 return value as CountryRegion;
}
export async function initializeCountryRegion(db:D1Database,id:string,country:string,locale:string):Promise<void>{
 const result=await db.prepare('UPDATE members SET country_region=? WHERE id=? AND country_region IS NULL').bind(defaultCountryRegion(country,locale),id).run();
 if(result.meta.changes===1)await bumpOp(db,'country_region','initialize','success');
}
export async function updateCountryRegion(db:D1Database,id:string,value:unknown):Promise<CountryRegion>{
 const region=parseCountryRegion(value);
 await db.prepare('UPDATE members SET country_region=? WHERE id=?').bind(region,id).run();
 await bumpOp(db,'country_region','save','success');
 return region;
}
