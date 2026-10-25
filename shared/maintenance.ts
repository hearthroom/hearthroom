export const MAINTENANCE_KEY = 'site_maintenance';
export const MAINTENANCE_POLL_MS = 15_000;
export const MAINTENANCE_LOCALES = ['zh-Hant','zh-Hans','en','ja','ko'] as const;
export interface MaintenanceState {
  enabled: boolean;
  endsAt: number | null;
  messages: Partial<Record<(typeof MAINTENANCE_LOCALES)[number], string>>;
}
export const maintenanceOff = (): MaintenanceState => ({enabled:false,endsAt:null,messages:{}});
/** Bad configuration/status must never be interpreted as a successful recovery. */
export function parseMaintenance(value: unknown): MaintenanceState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid maintenance state');
  const input=value as Record<string,unknown>;
  if (typeof input.enabled !== 'boolean') throw new Error('Invalid maintenance state');
  const endsAt=input.endsAt ?? null;
  if (endsAt!==null && (typeof endsAt!=='number' || !Number.isSafeInteger(endsAt) || endsAt<0)) throw new Error('Invalid maintenance estimate');
  const messages: MaintenanceState['messages']={};
  if (input.messages!==undefined) {
    if (!input.messages || typeof input.messages!=='object' || Array.isArray(input.messages)) throw new Error('Invalid maintenance messages');
    for (const locale of MAINTENANCE_LOCALES) {
      const message=(input.messages as Record<string,unknown>)[locale];
      if (message!==undefined) {
        if (typeof message!=='string' || message.length>500) throw new Error('Invalid maintenance message');
        messages[locale]=message;
      }
    }
  }
  return {enabled:input.enabled,endsAt,messages};
}
