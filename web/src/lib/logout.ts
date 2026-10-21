/**
 * 「登出」按鈕。這個瀏覽器有經換線帶過去、還登入著的其他線路時，先問一句要不要一起登出
 * （預設勾：共用裝置上登出的人通常想全部登出，PM 2026-10-22）；沒有就跟以前一樣一鍵登出。
 * 範圍只是這個瀏覽器，不是所有裝置；字也照實說，不承諾「立刻全部登出」。
 */
import { confirmCheck } from "./confirm";
import { i18n } from "./i18n";
import { currentLine, lineByOrigin } from "./route-lines";
import type { useSession } from "./session";
import { track } from "./track";

export async function logoutWithRoutes(session: ReturnType<typeof useSession>): Promise<void> {
  const t = i18n.global.t;
  const here = currentLine();
  const others = session.otherLines.map(lineByOrigin).filter((l): l is NonNullable<typeof l> => !!l && l.n !== here?.n);
  if (!others.length) {
    track("logout");
    await session.logout();
    return;
  }
  const answer = await confirmCheck({
    title: t("routes.logout.title"),
    message: t("routes.logout.body"),
    confirmText: t("nav.logout"),
    cancelText: t("routes.logout.keep"),
    focusCancel: true,
    check: {
      label: t("routes.logout.all"),
      hint: `${t("routes.logout.scope")}\n${others.map((l) => t("routes.lineHost", { line: t(`routes.name.${l.n}`), host: l.host })).join(t("routes.listSeparator"))}`,
      initial: true,
    },
  });
  if (!answer) return;
  track("logout");
  await session.logout({ allRoutes: answer.checked });
}
