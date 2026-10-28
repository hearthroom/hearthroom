/**
 * 頁尾的連結清單。頁尾不是一排越接越長的連結：每個入口都要先決定它屬於哪一組。
 *
 *   - 分組最多 FOOTER_LIMITS.groups 組、每組最多 FOOTER_LIMITS.linksPerGroup 個；放不下就是該開新的一組，
 *     或者該做一個彙整頁，而不是再往後接（owner 2026-10-05：頁尾已經擠到極限）。
 *   - 授權這類站務、法律連結不進分組，放在最底下那一條（之後的隱私權、使用條款也放那裡）。
 *   - 同一件事只給一個入口：「下載 App」頁本身就講了 Android App 和加到主畫面兩種裝法，
 *     所以能顯示它的地方就只放它；裝不了 APK 的裝置（iOS）才換成「安裝 App」直接叫出安裝提示。
 *   - 有條件的連結缺席時，那一組照樣在；整組都空了才拿掉。
 *
 * 這裡只放資料，畫面在 App.vue；路徑不帶語言前綴，由畫面那邊加。
 */

export interface FooterContext {
  repoUrl: string;
  license: string;
  discordInvite: string | null;
  /** lib/download.ts 的 shouldShowDownloadEntry */
  showDownloadEntry: boolean;
  /** 瀏覽器現在能把站台裝成 App（lib/pwa.ts 的 installPrompt，對象是站台） */
  canInstallSite: boolean;
  /** 目前線路：名稱的 i18n 鍵與網域（lib/routes.ts）；不在官方網域或在 App 裡是 null，頁尾就沒有「線路」 */
  routeLine: { name: string; host: string } | null;
}

interface LinkBase {
  /** 穩定的識別，測試和 v-for 的 key 用 */
  id: string;
  /** i18n 鍵 */
  label: string;
  labelArgs?: Record<string, string>;
  icon?: "discord" | "github";
  /** 「新」標記的鍵（shared/update-spotlights.ts） */
  newMark?: string;
  /** 接在連結後面的淡色補充（i18n 鍵），例如目前在哪條線路；detailHost 是接在後面不翻譯的網域 */
  detail?: string;
  detailHost?: string;
}
export type FooterLink =
  | (LinkBase & { to: string; query?: Record<string, string> })
  | (LinkBase & { href: string })
  | (LinkBase & { action: "install" | "routes" });

export interface FooterGroup {
  id: string;
  /** i18n 鍵 */
  title: string;
  links: FooterLink[];
}

export const FOOTER_LIMITS = { groups: 4, linksPerGroup: 5 } as const;

export function footerGroups(ctx: FooterContext): FooterGroup[] {
  const app: FooterLink[] = [];
  if (ctx.showDownloadEntry) app.push({ id: "download", label: "download.footer", to: "/download" });
  else if (ctx.canInstallSite) app.push({ id: "install", label: "pwa.install.link", action: "install" });
  app.push({ id: "updates", label: "nav.updates", to: "/updates", query: { from: "footer" }, newMark: "menu.updates" });
  // 線路（換網域）：游客唯一的平時入口，所以放頁尾；開的是線路清單，不是一頁
  if (ctx.routeLine) app.push({ id: "routes", label: "routes.title", action: "routes", detail: ctx.routeLine.name, detailHost: ctx.routeLine.host });

  const community: FooterLink[] = [{ id: "blog", label: "blog.title", to: "/blog" }];
  if (ctx.discordInvite) community.push({ id: "discord", label: "community.join", href: ctx.discordInvite, icon: "discord" });
  // 活動有期限，頁尾不追著它的開關跑：一律進活動中心，那一頁自己挑有活動的頁籤
  community.push(
    { id: "campaign", label: "campaign.hub.title", to: "/campaigns" },
    { id: "github", label: "footer.githubShort", href: ctx.repoUrl, icon: "github" },
    { id: "issues", label: "footer.issues", href: `${ctx.repoUrl}/issues` },
  );

  const groups: FooterGroup[] = [
    {
      id: "create",
      title: "footer.group.create",
      links: [
        { id: "guide", label: "footer.guide", to: "/guide" },
        { id: "developers", label: "footer.developers", to: "/developers" },
      ],
    },
    { id: "app", title: "footer.group.app", links: app },
    { id: "community", title: "footer.group.community", links: community },
  ];
  return groups.filter((g) => g.links.length > 0);
}

/** 最底下那一條：授權與之後的法律、站務連結。 */
export function footerLegal(ctx: FooterContext): FooterLink[] {
  return [
    { id: "privacy", label: "login.privacy", to: "/privacy" },
    { id: "license", label: "footer.license", labelArgs: { name: ctx.license }, href: `${ctx.repoUrl}/blob/main/LICENSE` },
  ];
}

/** Compact presentation only; public menus retain the complete navigation catalog. */
export function footerSupport(ctx: FooterContext): FooterLink[] {
  return [
    ...(ctx.repoUrl ? [{ id: "github", label: "footer.githubShort", href: ctx.repoUrl }, { id: "issues", label: "footer.issues", href: `${ctx.repoUrl}/issues` }] : []),
    ...footerLegal(ctx).filter(link => link.id !== "license" || !!ctx.repoUrl),
  ];
}
