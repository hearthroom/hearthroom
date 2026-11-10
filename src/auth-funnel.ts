import { isQABrowser } from './qa-browser-context';
import type { Env } from './types';

const STEPS = ['hearthroom_start', 'hearthroom_callback', 'hearthroom_session', 'hearthroom_first_entry'] as const;
const MODES = ['interactive', 'silent', 'unknown'] as const;
const LOCALES = ['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko', 'unknown'] as const;
const CODES = [
  'none', 'other_error', 'auth_input_invalid', 'auth_state_invalid', 'auth_provider_unavailable',
  'auth_provider_required', 'provider_unsupported', 'provider_not_configured',
  'auth_credentials_unavailable', 'auth_connection_denied', 'auth_reauthorization_required',
  'auth_silent_not_enabled', 'site_session_required', 'service_retired',
  'access_denied', 'login_required', 'consent_required', 'interaction_required',
  'account_selection_required', 'server_error', 'temporarily_unavailable',
] as const;

type Step = typeof STEPS[number];
type Mode = typeof MODES[number];
export type AuthFunnelDimensions = {mode: Mode; locale: unknown};

function has<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function countryCode(value: string): boolean {
  return /^[A-Z]{2}$/.test(value) && value !== 'XX';
}

export async function countAuthStep(
  env: Env,
  step: Step,
  {mode, locale}: AuthFunnelDimensions,
  request: Request,
  error?: string,
): Promise<void> {
  if (isQABrowser(env)) return;
  const edge = (request.cf?.country as string | undefined) || request.headers.get('CF-IPCountry') || '';
  const country = countryCode(edge) ? edge : 'unknown';
  const code = error === undefined ? 'none' : error !== 'none' && has(CODES, error) ? error : 'other_error';
  // An unavailable counter must never change an auth response or delay a redirect.
  try {
    await env.DB.prepare(`INSERT INTO auth_funnel_metrics (step, mode, locale, country, code, value)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT (step, mode, locale, country, code) DO UPDATE SET value = value + 1`)
      .bind(step, mode, has(LOCALES, locale) ? locale : 'unknown', country, code).run();
  } catch {
    console.warn('Auth funnel metric unavailable');
  }
}

export async function authFunnelMetrics(db: D1Database): Promise<string> {
  const {results} = await db.prepare('SELECT step, mode, locale, country, code, value FROM auth_funnel_metrics')
    .all<{step: string; mode: string; locale: string; country: string; code: string; value: number}>();
  const lines = [
    '# HELP auth_funnel_attempts_total Server-observed login and signup step outcomes.',
    '# TYPE auth_funnel_attempts_total counter',
  ];
  for (const {step, mode, locale, country, code, value} of results) {
    if (!has(STEPS, step) || !has(MODES, mode) || !has(LOCALES, locale) ||
        (country !== 'unknown' && !countryCode(country)) || !has(CODES, code)) continue;
    lines.push(`auth_funnel_attempts_total{step="${step}",mode="${mode}",app="hearthroom",locale="${locale}",country="${country}",result="${code === 'none' ? 'ok' : 'fail'}",code="${code}"} ${value}`);
  }
  return lines.join('\n') + '\n';
}
