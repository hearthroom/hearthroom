import { type ProviderId } from "./provider";
export function readCredential(
  key: string,
  provider: ProviderId
): string | null {
  return (
    localStorage.getItem(`${key}.${provider}`) ??
    (provider ===
    localStorage.getItem("hearthroom.provider")
      ? localStorage.getItem(key)
      : null)
  );
}
export function writeCredential(
  key: string,
  value: string,
  provider: ProviderId
): void {
  localStorage.setItem(`${key}.${provider}`, value);
  if (
    provider ===
    localStorage.getItem("hearthroom.provider")
  )
    localStorage.setItem(key, value);
}
export function removeCredential(key: string, provider: ProviderId): void {
  localStorage.removeItem(`${key}.${provider}`);
  if (
    provider ===
    localStorage.getItem("hearthroom.provider")
  )
    localStorage.removeItem(key);
}
