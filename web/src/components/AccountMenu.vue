<script setup lang="ts">
import AccountIcon from "@/components/AccountIcon.vue";
import ReviewBadge from "@/components/ReviewBadge.vue";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { hueFrom } from "@/lib/format";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { can } from "@/lib/provider";
import { useReviewer } from "@/lib/review";
import { track } from "@/lib/track";

const session = useSession();
// 窄螢幕把頁首那排導覽整排藏起來，這個選單就是手機上唯一的路——審核入口也得在這裡有一份。
const reviewerStore = useReviewer();
const { lp } = useLocalePath();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

/** 點外面或按 Esc 就收起來。 */
function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) { open.value = false; root.value?.querySelector<HTMLElement>("button")?.focus(); }
}
onMounted(() => { document.addEventListener("click", onDocClick); document.addEventListener("keydown", onKey); });
onBeforeUnmount(() => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onKey); });

</script>

<template>
  <div v-if="session.me" ref="root" class="acct">
    <!-- 餘額放在頁首：這是登入後最常想瞄一眼的數字 -->
    <RouterLink :to="lp('/wallet')" class="acct__credits" :title="$t('wallet.balance')">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.9 4.1 4.5.5-3.3 3.1.9 4.4L8 11.4l-3.9 2.2.9-4.4L1.6 6.1l4.5-.5z" /></svg>
      {{ $t("nav.wallet") }}
    </RouterLink>

    <button class="acct__btn" :aria-label="$t('nav.menu')" aria-haspopup="menu" :aria-expanded="open" @click="open = !open">
      <ReviewBadge dot />
      <img v-if="session.avatarUrl" :src="session.avatarUrl" alt="" class="acct__face" />
      <span v-else class="acct__face mono" :style="{ '--h': hueFrom(session.displayName) }">{{ [...session.displayName][0] }}</span>
    </button>

    <!-- 項目一多就分組：人先找組、再找項目。頁首已有入口的（通知有鈴鐺、對話與收藏有頂部分頁）不在這裡重複。 -->
    <div v-if="open" class="menu panel" role="menu" @click="open = false">
      <RouterLink :to="lp('/me')" class="menu__head" role="menuitem">
        <img v-if="session.avatarUrl" :src="session.avatarUrl" alt="" class="menu__face" />
        <span v-else class="menu__face mono" :style="{ '--h': hueFrom(session.displayName) }">{{ [...session.displayName][0] }}</span>
        <span class="menu__who">
          <strong class="menu__name">{{ session.displayName }}</strong>
          <span class="menu__sub">{{ $t("nav.me") }}</span>
        </span>
        <AccountIcon name="arrow" class="menu__chevron" />
      </RouterLink>
      <div class="menu__group">
        <RouterLink :to="lp('/wallet')" class="menu__item" role="menuitem"><AccountIcon name="wallet" />{{ $t("nav.wallet") }}</RouterLink>
      </div>
      <div class="menu__group">
        <RouterLink :to="lp('/mine')" class="menu__item" role="menuitem"><AccountIcon name="cards" />{{ $t("nav.mine") }}</RouterLink>
        <RouterLink v-if="can('library')" :to="lp('/resources')" class="menu__item" role="menuitem"><AccountIcon name="folder" />{{ $t("nav.resources") }}</RouterLink>
        <RouterLink v-if="reviewerStore.reviewer" :to="lp('/review')" class="menu__item" role="menuitem"><AccountIcon name="shield" />{{ $t("nav.review") }}<ReviewBadge /></RouterLink>
      </div>
      <div class="menu__group">
        <RouterLink :to="lp('/settings')" class="menu__item" role="menuitem"><AccountIcon name="settings" />{{ $t("nav.settings") }}</RouterLink>
        <!-- 開發者文件（相容供應商協議）：頁尾有，但登入的作者從頭像選單也走得到 -->
        <RouterLink :to="lp('/developers')" class="menu__item" role="menuitem"><AccountIcon name="code" />{{ $t("footer.developers") }}</RouterLink>
      </div>
      <div class="menu__group">
        <button class="menu__item" role="menuitem" @click="track('logout'); session.logout()"><AccountIcon name="logout" />{{ $t("nav.logout") }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.acct { position: relative; display: flex; align-items: center; gap: var(--s-2); }

.acct__credits {
  display: inline-flex; align-items: center; gap: 5px;
  height: 32px; padding: 0 12px 0 10px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums;
  transition: background var(--dur) var(--ease);
}
.acct__credits:hover { background: var(--border); }
.acct__credits svg { width: 13px; height: 13px; fill: var(--gold); filter: drop-shadow(0 1px 1px rgba(242, 176, 30, 0.35)); }

.acct__btn { position:relative; padding: 2px; background: none; border: 0; border-radius: var(--r-pill); cursor: pointer; display: inline-flex; }
.acct__btn:hover { background: var(--surface-2); }
.acct__face { width: 30px; height: 30px; border-radius: var(--r-pill); object-fit: cover; font-size: 13px; }

.menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
  min-width: 220px; padding: 6px;
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  animation: fade var(--dur) var(--ease);
}
.menu__head {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: var(--r-sm); color: var(--text);
}
.menu__head:hover { background: var(--surface-2); }
.menu__face { width: 36px; height: 36px; flex: none; border-radius: var(--r-pill); object-fit: cover; font-size: 15px; }
.menu__who { display: grid; gap: 1px; min-width: 0; flex: 1; }
.menu__name { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu__sub { font-size: 12px; color: var(--text-2); }
.menu__chevron { width: 16px; height: 16px; color: var(--text-2); }
/* 組與組之間一條細線；第一組上面那條把頭像卡跟清單隔開 */
.menu__group { display: grid; padding-top: 6px; margin-top: 6px; border-top: 1px solid var(--line); }
.menu__item {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; text-align: left;
  background: none; border: 0; border-radius: var(--r-sm);
  font-size: 13.5px; color: var(--text); cursor: pointer;
}
.menu__item svg { width: 18px; height: 18px; color: var(--text-2); }
.menu__item:hover { background: var(--surface-2); }
@keyframes fade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
</style>
