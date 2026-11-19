import { deleteAuthorRuleStore } from "stage-author-rules/store";
import { preloadStage } from "./stage-preload";

export const stageAvailable = true;

export const stageSite = {
  preload: preloadStage,
  clearRuleStore: deleteAuthorRuleStore,
  loadDisplayScript: () => import("moonstage/display-script"),
  loadPlay: () => import("../pages/PlayPage.vue"),
  loadEditor: () => import("../pages/CardEditorPage.vue"),
  loadWorkshopEditor: () => import("../pages/ExtensionEditorPage.vue"),
  loadReview: () => import("../pages/ReviewDetailPage.vue"),
};
