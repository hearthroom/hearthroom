/**
 * 留言面板的審核狀態：自己被攔下的留言留在原位標「審核中」；被移除的頂層只留一行說明、回覆照常；
 * 別人的公開留言可以檢舉。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, ref, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

const base = { parentId: "", rootId: "", replyToNickName: "", likeCount: 0, replyCount: 0, createTime: new Date().toISOString(), accountAvatar: "", isLiked: false, isCreator: false, score: null };
const comment = (id: string, extra: Record<string, unknown> = {}) => ({ ...base, commentId: id, content: `text ${id}`, accountNickName: `name ${id}`, handle: `h${id}`, isOwner: false, canDelete: false, status: "visible", removed: false, ...extra });

const api = vi.hoisted(() => ({
  list: [] as unknown[],
  fetchComments: vi.fn(),
  fetchReplies: vi.fn(async () => ({ total: 0, replies: [] })),
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  likeComment: vi.fn(),
  reportComment: vi.fn(async () => ({ ok: true, folded: false })),
}));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<object>()), ...api, fetchComments: (...a: unknown[]) => api.fetchComments(...a) }));
const tokenFixture = vi.hoisted(() => ({ accessToken: vi.fn(async () => "synthetic") }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 7, avatar: "" }, ready: true, accessToken: tokenFixture.accessToken }) }));
vi.mock("../src/lib/community-appearance", () => ({ usePublicAppearance: () => ref(null) }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "web" }));
const staff = vi.hoisted(() => ({ reviewer: false as boolean | null, role: "reviewer" as string, blogWriter: false, setPostState: vi.fn(async () => ({})) }));
vi.mock("../src/lib/review", () => ({ useReviewer: () => staff }));
vi.mock("../src/lib/blog", async (original) => ({ ...(await original<object>()), setPostState: (...a: unknown[]) => staff.setPostState(...a) }));

import CommentPanel from "../src/components/CommentPanel.vue";

let app: App, host: HTMLElement;
beforeEach(async () => {
  i18n.global.locale.value = "zh-Hant";
  Object.assign(staff, { reviewer: false, role: "reviewer", blogWriter: false });
  tokenFixture.accessToken.mockReset().mockResolvedValue("synthetic");
  api.list = [];
  api.fetchComments.mockReset().mockImplementation(async () => ({ total: api.list.length, comments: api.list, isRoleCreator: false }));
  host = document.body.appendChild(document.createElement("div"));
});
afterEach(() => { app?.unmount(); host.remove(); document.body.innerHTML = ""; vi.clearAllMocks(); });

async function mount(props: Record<string, unknown> = { cardId: "1", roleId: "r1" }) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push("/cards/1");
  app = createApp(CommentPanel, props).use(router).use(i18n);
  app.mount(host);
  await vi.waitFor(() => expect(api.fetchComments).toHaveBeenCalled());
  await nextTick();
}
const t = (k: string) => i18n.global.t(k);
const buttons = (root: ParentNode, text: string) => [...root.querySelectorAll("button")].filter((b) => b.textContent?.trim() === text);

it("keeps a held comment in place, marked as under review, and says it will appear once reviewed", async () => {
  await mount();
  api.createComment.mockImplementation(async () => { api.list = [comment("new", { isOwner: true, canDelete: true, status: "held" })]; return { commentId: "new", status: "held" }; });
  const box = host.querySelector<HTMLTextAreaElement>(".cmt__composer textarea")!;
  box.value = "hello"; box.dispatchEvent(new Event("input")); await nextTick();
  buttons(host, t("comment.submit"))[0]!.click();
  await vi.waitFor(() => expect(host.querySelector(".cmt__item")?.textContent).toContain(t("comment.held")));
  expect(host.querySelector<HTMLTextAreaElement>(".cmt__composer textarea")!.value).toBe("");
  expect(host.textContent).toContain(t("comment.submitted"));
});

it("shows a removed top-level comment as one line without its author or actions, and keeps its replies", async () => {
  api.list = [comment("gone", { removed: true, status: "removed", content: "", canDelete: false, replyCount: 1, replies: [comment("child", { rootId: "gone", parentId: "gone" })] })];
  await mount();
  const item = host.querySelector(".cmt__item")!;
  expect(item.textContent).toContain(t("comment.removed"));
  expect(item.textContent).not.toContain("name gone");
  expect(item.textContent).toContain("text child");
  const top = item.querySelector(":scope > .cmt__body > .cmt__actions");
  expect(top).toBeNull();
  // 底下那則回覆照常能檢舉；被移除的那則沒有自己的檢舉鍵
  expect(buttons(item, t("comment.report"))).toHaveLength(1);
  expect(buttons(item, t("comment.delete"))).toHaveLength(0);
});

it("reports someone else's comment with the chosen reason", async () => {
  api.list = [comment("c1"), comment("mine", { isOwner: true, canDelete: true })];
  await mount();
  expect(buttons(host.querySelectorAll(".cmt__item")[1]!, t("comment.report"))).toHaveLength(0);
  buttons(host.querySelector(".cmt__item")!, t("comment.report"))[0]!.click();
  await nextTick();
  const dialog = document.querySelector("[role=dialog]")!;
  expect(dialog.textContent).toContain(t("comment.reportTitle"));
  const spam = dialog.querySelector<HTMLInputElement>("input[value=spam]")!;
  spam.checked = true; spam.dispatchEvent(new Event("change")); await nextTick();
  buttons(dialog, t("comment.reportSubmit"))[0]!.click();
  await vi.waitFor(() => expect(api.reportComment).toHaveBeenCalledWith("c1", { reason: "spam", note: "" }, "synthetic"));
  await vi.waitFor(() => expect(host.textContent).toContain(t("comment.reportThanks")));
  expect(document.querySelector("[role=dialog]")).toBeNull();
});

it("keeps Tab inside the report dialog: the last control wraps to the first and back", async () => {
  api.list = [comment("c1")];
  await mount();
  buttons(host.querySelector(".cmt__item")!, t("comment.report"))[0]!.click();
  await nextTick(); await nextTick();
  const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
  const first = dialog.querySelector<HTMLInputElement>("input[value=spam]")!;
  const last = buttons(dialog, t("dialog.cancel"))[0]!; // 還沒選理由：送出鍵停用，不算在內
  const tab = (shiftKey: boolean) => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true }));
  last.focus(); tab(false);
  expect(document.activeElement).toBe(first);
  tab(true);
  expect(document.activeElement).toBe(last);
});

it("offers reply only under a public top-level comment, not under a removed one or the viewer's own held one", async () => {
  const child = (id: string, root: string) => comment(id, { rootId: root, parentId: root });
  api.list = [
    comment("gone", { removed: true, status: "removed", content: "", replyCount: 1, replies: [child("c1", "gone")] }),
    comment("folded", { status: "held", isOwner: true, canDelete: true, replyCount: 1, replies: [child("c2", "folded")] }),
    comment("open", { replyCount: 1, replies: [child("c3", "open")] }),
  ];
  await mount();
  const [gone, folded, open] = [...host.querySelectorAll(".cmt__item")];
  expect(buttons(gone!, t("comment.reply"))).toHaveLength(0);
  expect(buttons(folded!, t("comment.reply"))).toHaveLength(0);
  expect(buttons(open!, t("comment.reply"))).toHaveLength(2);
});

it("reads card comments from the card, without a sort", async () => {
  await mount();
  expect(api.fetchComments).toHaveBeenCalledWith("1", 1, "synthetic", undefined);
  expect(host.querySelector(".cmt__sort")).toBeNull();
});

const postTarget = (extra: Record<string, unknown> = {}) => ({ target: { kind: "post", postId: "p1", ...extra } });

it("on a post, marks official commenters and the pinned comment, and switches between hot and new", async () => {
  api.list = [comment("pin", { official: true }), comment("c2")];
  api.fetchComments.mockImplementation(async () => ({ total: 2, comments: api.list, isRoleCreator: false, pinnedCommentId: "pin" }));
  await mount(postTarget());
  expect(api.fetchComments).toHaveBeenLastCalledWith({ postId: "p1" }, 1, "synthetic", "hot");
  const [pin, other] = [...host.querySelectorAll(".cmt__item")];
  expect(pin!.textContent).toContain(t("comment.official"));
  expect(pin!.textContent).toContain(t("comment.pinned"));
  expect(other!.textContent).not.toContain(t("comment.official"));
  expect(other!.textContent).not.toContain(t("comment.pinned"));
  buttons(host, t("comment.sortNew"))[0]!.click();
  await vi.waitFor(() => expect(api.fetchComments).toHaveBeenLastCalledWith({ postId: "p1" }, 1, "synthetic", "new"));
  expect(buttons(host, t("comment.sortNew"))[0]!.getAttribute("aria-pressed")).toBe("true");
});

it("on a post with comments closed, keeps the comments but offers no composer or reply", async () => {
  api.list = [comment("c1")];
  await mount(postTarget({ commentsClosed: true }));
  expect(host.textContent).toContain(t("comment.closed"));
  expect(host.querySelector(".cmt__composer")).toBeNull();
  expect(host.textContent).toContain("text c1");
  expect(buttons(host, t("comment.reply"))).toHaveLength(0);
});

it("closes the composer when the post is closed while someone is writing", async () => {
  await mount(postTarget());
  const { ApiError } = await import("../src/lib/api");
  api.createComment.mockRejectedValue(new ApiError(403, "closed", "blog_comments_closed"));
  const box = host.querySelector<HTMLTextAreaElement>(".cmt__composer textarea")!;
  box.value = "hello"; box.dispatchEvent(new Event("input")); await nextTick();
  buttons(host, t("comment.submit"))[0]!.click();
  await vi.waitFor(() => expect(host.textContent).toContain(t("comment.closed")));
  expect(api.createComment).toHaveBeenCalledWith({ postId: "p1" }, { content: "hello", parentId: undefined, rootId: undefined }, "synthetic");
  expect(host.querySelector(".cmt__composer")).toBeNull();
});

it("lets a blog writer pin a public comment on a post and unpin it again", async () => {
  Object.assign(staff, { reviewer: false, blogWriter: true });
  let pinned: string | null = null;
  api.list = [comment("c1"), comment("held", { isOwner: true, status: "held" })];
  api.fetchComments.mockImplementation(async () => ({ total: 2, comments: api.list, isRoleCreator: false, pinnedCommentId: pinned }));
  staff.setPostState.mockImplementation(async (_t: unknown, _id: unknown, change: { pinnedCommentId: string | null }) => { pinned = change.pinnedCommentId; return {}; });
  await mount(postTarget());
  const [first, held] = [...host.querySelectorAll(".cmt__item")];
  expect(buttons(held!, t("comment.pin"))).toHaveLength(0);
  buttons(first!, t("comment.pin"))[0]!.click();
  await vi.waitFor(() => expect(host.querySelector(".cmt__item .cmt__badge--pin")).not.toBeNull());
  expect(staff.setPostState).toHaveBeenLastCalledWith("synthetic", "p1", { pinnedCommentId: "c1" }, expect.any(String));
  buttons(host.querySelector(".cmt__item")!, t("comment.unpin"))[0]!.click();
  await vi.waitFor(() => expect(staff.setPostState).toHaveBeenLastCalledWith("synthetic", "p1", { pinnedCommentId: null }, expect.any(String)));
  await vi.waitFor(() => expect(host.querySelector(".cmt__badge--pin")).toBeNull());
});

it("offers no pin to readers, reviewers who cannot write the blog, or on card comments", async () => {
  api.list = [comment("c1")];
  await mount(postTarget());
  expect(buttons(host, t("comment.pin"))).toHaveLength(0);
  app.unmount(); host.innerHTML = "";
  Object.assign(staff, { reviewer: true, role: "owner", blogWriter: false });
  await mount(postTarget());
  expect(buttons(host, t("comment.pin"))).toHaveLength(0);
  app.unmount(); host.innerHTML = "";
  Object.assign(staff, { reviewer: true, role: "owner", blogWriter: true });
  await mount();
  expect(buttons(host, t("comment.pin"))).toHaveLength(0);
});

it("names the like button for screen readers and reports whether it is on", async () => {
  api.list = [comment("c1", { isLiked: true, likeCount: 2 })];
  await mount();
  const like = host.querySelector<HTMLButtonElement>(".cmt__item .cmt__act")!;
  expect(like.getAttribute("aria-label")).toBe(t("comment.like"));
  expect(like.getAttribute("aria-pressed")).toBe("true");
});

it("a muted viewer sees until when they can comment again, with no composer and no reply", async () => {
  const until = Date.UTC(2030, 0, 2, 3, 4);
  api.list = [comment("c1")];
  api.fetchComments.mockImplementation(async () => ({ total: 1, comments: api.list, isRoleCreator: false, mutedUntil: until }));
  await mount();
  const { dateTime } = await import("../src/lib/format");
  expect(host.textContent).toContain(i18n.global.t("comment.error.mutedUntil", { date: dateTime(until) }));
  expect(host.querySelector(".cmt__composer")).toBeNull();
  expect(buttons(host, t("comment.reply"))).toHaveLength(0);
  expect(host.textContent).toContain("text c1");
});

it("a permanent mute says so; a mute found on send folds the composer", async () => {
  api.list = [comment("c1")];
  await mount();
  const { ApiError } = await import("../src/lib/api");
  api.createComment.mockRejectedValue(new ApiError(403, "muted", "comment_muted"));
  api.fetchComments.mockImplementation(async () => ({ total: 1, comments: api.list, isRoleCreator: false, mutedUntil: null }));
  const box = host.querySelector<HTMLTextAreaElement>(".cmt__composer textarea")!;
  box.value = "hello"; box.dispatchEvent(new Event("input")); await nextTick();
  buttons(host, t("comment.submit"))[0]!.click();
  await vi.waitFor(() => expect(host.textContent).toContain(t("comment.error.mutedPermanent")));
  expect(host.querySelector(".cmt__composer")).toBeNull();
  expect(buttons(host, t("comment.reply"))).toHaveLength(0);
});

it("shows a temporary token failure without an unhandled like action or optimistic mutation", async () => {
  api.list = [comment("c1")];
  await mount();
  const errors: unknown[] = [];
  app.config.errorHandler = error => { errors.push(error); };
  const { AuthUnavailable } = await import("../src/lib/oauth");
  tokenFixture.accessToken.mockRejectedValue(new AuthUnavailable(t("state.serverBusy")));
  const like = host.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!;
  expect(like).not.toBeNull();
  like.click();
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(errors).toEqual([]);
  expect(host.textContent).toContain(t("state.serverBusy"));
  expect(like.getAttribute('aria-pressed')).toBe('false');
});
