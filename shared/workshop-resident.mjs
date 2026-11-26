export const MAX_PLAYER_CONSTANT_CHARS = 1500;
export const MAX_AUTHOR_DLC_CONSTANT_CHARS = 5000;

export function workshopResidentLimit(kind) {
  return kind === "dlc" ? MAX_AUTHOR_DLC_CONSTANT_CHARS : MAX_PLAYER_CONSTANT_CHARS;
}
