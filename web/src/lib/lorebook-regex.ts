import contract from "./lorebook-regex.json";

// Mirrored in cli/internal/check/lorebook-regex.json. Keep both contracts and
// the shared original fixture corpus identical; no author patterns are executed.
const wrapper = new RegExp(contract.wrapper);
const constructs = contract.constructs.map((pattern) => new RegExp(pattern));
export function looksLikeBareRegex(key: string): boolean {
  // Match the Provider's Go strings.TrimSpace (Unicode White_Space, not BOM).
  key = key.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  return !wrapper.test(key) && constructs.some((rule) => rule.test(key));
}
