import type { Locale } from "./blog";

/** List and article contexts deliberately have different fallback contracts. */
export function languageOrder(viewer: Locale, source: Locale, context: "list" | "article"): Locale[] {
  const order: Locale[] = [viewer];
  if (viewer === "zh-Hant") order.push("zh-Hans");
  if (viewer === "zh-Hans") order.push("zh-Hant");
  if (context === "article") order.push(source, "zh-Hant", "zh-Hans", "en", "ja", "ko");
  return [...new Set(order)];
}

/** Bindings: ?1 now, ?2 viewer locale, ?3 column slug, ?4 group slug. */
export function translationListCte(visible = true): string {
  const visibleColumn = visible ? "AND col.enabled=1 AND col.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM blog_columns parent WHERE parent.id=col.parent_id AND parent.enabled=1)" : "";
  return `WITH candidates AS (
    SELECT p.id,COALESCE(p.translation_group_id,p.id) AS group_key,COALESCE(g.source_locale,p.locale) AS source_locale,
      (SELECT MIN(q.first_published_at) FROM blog_posts q WHERE COALESCE(q.translation_group_id,q.id)=COALESCE(p.translation_group_id,p.id)
        AND (q.was_public=1 OR (q.status='published' AND q.publish_at<=?1))) AS group_published_at,
      (SELECT MAX(q.pinned) FROM blog_posts q WHERE COALESCE(q.translation_group_id,q.id)=COALESCE(p.translation_group_id,p.id) AND q.status='published' AND q.publish_at IS NOT NULL AND q.publish_at<=?1) AS group_pinned,
      ROW_NUMBER() OVER(PARTITION BY COALESCE(p.translation_group_id,p.id) ORDER BY CASE WHEN p.locale=?2 THEN 0 ELSE 1 END,p.first_published_at,p.id) AS preference
    FROM blog_posts p JOIN blog_columns col ON col.id=p.column_id LEFT JOIN blog_translation_groups g ON g.id=p.translation_group_id
    WHERE p.status='published' AND p.publish_at IS NOT NULL AND p.publish_at<=?1 ${visibleColumn}
      AND (p.locale=?2 OR (?2='zh-Hant' AND p.locale='zh-Hans') OR (?2='zh-Hans' AND p.locale='zh-Hant'))
      AND (?3 IS NULL OR col.slug=?3) AND (?4 IS NULL OR col.parent_id=(SELECT id FROM blog_columns WHERE slug=?4 AND parent_id IS NULL))
  ),chosen AS (SELECT * FROM candidates WHERE preference=1)`;
}

export function languageRank(locale: Locale, viewer: Locale, source: Locale): number {
  if (locale === viewer) return 0;
  if ((viewer === "zh-Hant" && locale === "zh-Hans") || (viewer === "zh-Hans" && locale === "zh-Hant")) return 1;
  return locale === source ? 2 : 3;
}
