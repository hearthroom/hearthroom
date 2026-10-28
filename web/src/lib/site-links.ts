import { computed, inject, onBeforeUnmount, watch, type ComputedRef, type InjectionKey, type Ref } from "vue";
import type { SidebarRect } from "./sidebar-clearance";
import { footerGroups, footerLegal, footerSupport, type FooterContext } from "./footer-nav";

export const petMenuKey: InjectionKey<ComputedRef<boolean>> = Symbol("pet-menu");
export const siteLinksKey: InjectionKey<ComputedRef<FooterContext>> = Symbol("site-links");
export const sidebarBoundsKey: InjectionKey<Ref<SidebarRect | null>> = Symbol("sidebar-bounds");
export const boardListEndKey: InjectionKey<Ref<boolean>> = Symbol("board-list-end");
export const boardEndKey: InjectionKey<Ref<boolean>> = Symbol("board-end");
export const headerOverlaysKey: InjectionKey<Set<symbol>> = Symbol("header-overlays");
/** A header menu temporarily owns interaction; covered page controls must not take focus. */
export function useHeaderOverlay(open: Ref<boolean>) {
  const overlays = inject(headerOverlaysKey, undefined);
  const id = Symbol();
  watch(open, value => { if (value) overlays?.add(id); else overlays?.delete(id); }, { flush: "sync" });
  onBeforeUnmount(() => overlays?.delete(id));
}
export function useSiteLinks() {
  const context = inject(siteLinksKey, computed<FooterContext>(() => ({ repoUrl: "", license: "", discordInvite: null, showDownloadEntry: false, canInstallSite: false, routeLine: null })));
  const groups = computed(() => footerGroups(context.value));
  const legal = computed(() => footerLegal(context.value));
  const links = computed(() => [...groups.value.flatMap(group => group.links), ...legal.value]);
  const support = computed(() => footerSupport(context.value));
  return { context, groups, legal, links, support };
}
