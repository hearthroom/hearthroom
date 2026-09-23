import { HttpError } from "./types";

/** Historical receipts may name a retired issuer; runtime requests accept Harbor only. */
export type ProviderId = "harbor" | "lunatalk";
export const PROVIDER_IDS = ["harbor"] as const;
export const DEFAULT_PROVIDER: ProviderId = "harbor";
export const PROVIDER_NAMES: Partial<Record<ProviderId,string>> = {harbor:"HarperHarbor"};
export interface ProviderEnv { PROVIDER_API_BASE_HARBOR?: string }
export function parseProvider(header: string | undefined | null): ProviderId {
 const raw=(header??"harbor").trim().toLowerCase()||"harbor";
 if(raw!=="harbor")throw new HttpError(400,"unknown provider");
 return "harbor";
}
export function apiBaseOf(env:ProviderEnv,provider:ProviderId=DEFAULT_PROVIDER,_country=""):string {
 parseProvider(provider);
 const base=(env.PROVIDER_API_BASE_HARBOR??"").trim();
 if(!base)throw new HttpError(400,"provider not configured");
 return base;
}
export function configuredProviders(env:ProviderEnv):ProviderId[]{return env.PROVIDER_API_BASE_HARBOR?.trim()?["harbor"]:[]}
export function requireConfigured(env:ProviderEnv,provider:ProviderId):ProviderId {apiBaseOf(env,provider);return provider}
export function providerApiBaseFor(env:ProviderEnv,_country:string):string{return apiBaseOf(env)}
export function hasChat(provider:ProviderId):boolean{return provider==="harbor"}
export function reviewEnabled(env:{REVIEW_ENABLED?:string}):boolean{return (env.REVIEW_ENABLED??"").trim().toLowerCase()==="true"}
