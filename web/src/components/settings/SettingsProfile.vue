<script setup lang="ts">
/**
 * 設定 › 個人資料：他人看主頁時的關注與粉絲（任務 2026-11-19-profile-visibility ui.md §3.5）與榜單隱私。
 * 暱稱、頭像、簡介在「我的」頁的編輯模式（/me?edit=1），這裡只放一列連過去。
 *
 * 選了就存，沒有儲存鈕；連續點選以最後一次為準，失敗時選項彈回伺服器上的值。
 * 選項卡跟卡片「公開範圍」是同一套樣式（base.css .visibility-option），同一個產品裡「誰看得到」只有一種長相。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import AccountIcon from "@/components/AccountIcon.vue";
import LeaderboardPrivacy from "@/components/LeaderboardPrivacy.vue";
import ProfileStats from "@/components/profile/ProfileStats.vue";
import { fetchAuthor, updateSiteSettings } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import type { Author, FollowersVisibility, FollowingVisibility } from "@/lib/types";

const { t } = useI18n();
const { lp } = useLocalePath();
const session = useSession();

const following = computed<FollowingVisibility>(() => session.profile?.followingVisibility ?? "count");
const followers = computed<FollowersVisibility>(() => session.profile?.followersVisibility ?? "count");
const groups = [
  { key: "following" as const, icon: "users" as const, options: ["list", "count", "hidden"] as const },
  { key: "followers" as const, icon: "heart" as const, options: ["list", "count"] as const },
];
const optionIcon = { list: "users", count: "hash", hidden: "eyeOff" } as const;
const current = (key: "following" | "followers") => (key === "following" ? following.value : followers.value);

const error = ref("");
const saved = ref(false);
let sequence = 0, savedTimer: ReturnType<typeof setTimeout> | undefined;
/** 伺服器上最後一次確認的值：失敗時彈回這裡 */
let confirmed: { following: FollowingVisibility; followers: FollowersVisibility } | null = null;

async function choose(key: "following" | "followers", value: string) {
  const profile = session.profile;
  if (!profile || current(key) === value) return;
  confirmed ??= { following: following.value, followers: followers.value };
  const seq = ++sequence;
  error.value = "";
  if (key === "following") profile.followingVisibility = value as FollowingVisibility;
  else profile.followersVisibility = value as FollowersVisibility;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error("no token");
    const result = await updateSiteSettings(key === "following" ? { followingVisibility: value as FollowingVisibility } : { followersVisibility: value as FollowersVisibility }, token);
    const now = { following: result.followingVisibility ?? "count", followers: result.followersVisibility ?? "count" };
    confirmed = now;
    if (seq !== sequence) return;
    profile.followingVisibility = now.following;
    profile.followersVisibility = now.followers;
    confirmed = null;
    saved.value = true;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { saved.value = false; }, 1800);
  } catch (err) {
    if (seq !== sequence) return;
    if (confirmed) { profile.followingVisibility = confirmed.following; profile.followersVisibility = confirmed.followers; }
    confirmed = null;
    saved.value = false;
    error.value = t("settings.profile.saveFailed");
  }
}

// ---- 他人看到的樣子：作品數與被聊過從公開作者頁來，關注與粉絲用本人的真實數字套上設定 ----
const author = ref<Author | null>(null);
onMounted(async () => {
  const handle = session.profile?.handle;
  if (!handle) return;
  try { author.value = await fetchAuthor(handle); } catch { /* 預覽的作品數拿不到就寫 0，不擋設定 */ }
});
onBeforeUnmount(() => clearTimeout(savedTimer));
</script>

<template>
  <section class="panel set-card">
    <div class="set-card__head profile-vis__head">
      <p class="eyebrow">{{ $t("settings.profile.title") }}</p>
      <span v-if="saved" class="profile-vis__saved" role="status"><AccountIcon name="check" />{{ $t("settings.profile.saved") }}</span>
    </div>
    <RouterLink :to="{ path: lp('/me'), query: { edit: '1' } }" class="content__row content__link">
      <span class="content__text"><strong>{{ $t("profile.editProfile") }}</strong><span class="subtle">{{ $t("settings.profile.edit") }}</span></span>
      <AccountIcon name="arrow" />
    </RouterLink>
    <div class="profile-vis">
      <fieldset v-for="g in groups" :key="g.key" class="profile-vis__group">
        <legend class="profile-vis__legend"><AccountIcon :name="g.icon" />{{ $t(`profile.stat.${g.key}`) }}</legend>
        <div class="visibility-options">
          <label v-for="o in g.options" :key="o" class="visibility-option" :class="{ 'visibility-option--selected': current(g.key) === o }">
            <AccountIcon :name="optionIcon[o]" class="profile-vis__icon" />
            <span class="visibility-option__body">
              <span class="visibility-option__title">{{ $t(`settings.profile.${g.key}.${o}.title`) }}</span>
              <span :id="`profile-vis-${g.key}-${o}`" class="visibility-option__description">{{ $t(`settings.profile.${g.key}.${o}.desc`) }}</span>
            </span>
            <input type="radio" :name="`profile-vis-${g.key}`" :value="o" :checked="current(g.key) === o" :aria-describedby="`profile-vis-${g.key}-${o}`" @change="choose(g.key, o)" />
          </label>
        </div>
      </fieldset>
      <p class="profile-vis__fixed">{{ $t("settings.profile.alwaysPublicNote") }}</p>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    </div>
  </section>

  <section v-if="session.profile" class="panel set-card profile-vis__preview">
    <p class="eyebrow">{{ $t("settings.profile.previewTitle") }}</p>
    <ProfileStats
      :works="author?.cardCount ?? 0"
      :chats="author?.talkTotal ?? 0"
      :followers="session.profile.followers ?? 0"
      :following="following === 'hidden' ? null : session.profile.following ?? 0"
      :following-open="following === 'list'"
      :followers-open="followers === 'list'"
      preview
    />
  </section>

  <section id="leaderboard-privacy" class="panel set-card">
    <p class="eyebrow set-card__head">{{ $t("spendBoard.privacySettings") }}</p>
    <LeaderboardPrivacy />
  </section>
</template>

<style scoped>
.profile-vis__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.profile-vis__head .eyebrow { margin: 0; }
.profile-vis__saved { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; line-height: 1; color: var(--success); }
.profile-vis__saved svg { width: 14px; height: 14px; }
.profile-vis { display: grid; gap: var(--s-5); }
.profile-vis__group { min-width: 0; margin: 0; padding: 0; border: 0; }
.profile-vis__legend { display: flex; align-items: center; gap: var(--s-2); margin-bottom: var(--s-3); padding: 0; font-size: 15px; font-weight: 600; }
.profile-vis__legend svg { width: 16px; height: 16px; color: var(--text-2); }
.profile-vis__icon { color: var(--text-2); }
.profile-vis__fixed { margin: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 13px; line-height: 1.6; color: var(--text-2); }
.profile-vis__preview { display: grid; gap: var(--s-3); }
.profile-vis__preview .eyebrow { margin: 0; }
:lang(ko) .profile-vis { word-break: keep-all; }
:lang(ja) .profile-vis { word-break: auto-phrase; }
@media (max-width: 480px) { .visibility-option { min-height: var(--h-lg); } }
</style>
