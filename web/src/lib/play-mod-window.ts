import { reactive } from "vue";

export const playModWindow = reactive({
  open: false,
  conversationId: "",
  acceptedTurn: 0,
  settingsChanged: 0,
  showCapacity: undefined as (() => void) | undefined,
});

export function setPlayModScope(conversationId: string) {
  if (playModWindow.conversationId === conversationId) return;
  playModWindow.open = false;
  playModWindow.conversationId = conversationId;
  playModWindow.showCapacity = undefined;
}

export function openPlayModWindow(conversationId: string, showCapacity?: () => void) {
  if (!conversationId) return;
  setPlayModScope(conversationId);
  playModWindow.showCapacity = showCapacity;
  playModWindow.open = true;
}
