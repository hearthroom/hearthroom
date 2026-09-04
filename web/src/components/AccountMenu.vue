<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { whole } from "@/lib/format";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";

const session = useSession();
const { lp } = useLocalePath();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

/** 點外面或按 Esc 就收起來。 */
function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") open.value = false;
}
onMounted(() => { document.addEventListener("click", onDocClick); document.addEventListener("keydown", onKey); });
onBeforeUnmount(() => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onKey); });

const PLAN_LABEL: Record<string, string> = { unlimited: "wallet.plan.unlimited", member: "wallet.plan.member", trial: "wallet.plan.trial" };
</script>

<template>
  <div v-if="session.me" ref="root" class="acct">
    <!-- 餘額放在頁首：這是登入後最常想瞄一眼的數字 -->
    <RouterLink v-if="session.wallet" :to="lp('/wallet')" class="acct__credits" :title="$t('wallet.balance')">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.9 4.1 4.5.5-3.3 3.1.9 4.4L8 11.4l-3.9 2.2.9-4.4L1.6 6.1l4.5-.5z" /></svg>
      {{ whole(session.wallet.score + session.wallet.tempScore) }}
    </RouterLink>

    <button class="acct__btn" :aria-label="$t('nav.menu')" aria-haspopup="menu" :aria-expanded="open" @click="open = !open">
      <img v-if="session.me.avatar" :src="session.me.avatar" alt="" class="acct__face" />
      <span v-else class="acct__face acct__face--void">{{ [...session.me.nickName][0] }}</span>
    </button>

    <div v-if="open" class="menu panel" role="menu" @click="open = false">
      <div class="menu__head">
        <strong class="menu__name">{{ session.me.nickName }}</strong>
        <span v-if="session.wallet?.plans.length" class="menu__plan">{{ $t(PLAN_LABEL[session.wallet.plans[0]!.tier] ?? "wallet.plan") }}</span>
      </div>
      <RouterLink :to="lp(`/authors/${session.me.accountNumId}`)" class="menu__item" role="menuitem">{{ $t("nav.authorPage") }}</RouterLink>
      <RouterLink :to="lp('/mine')" class="menu__item" role="menuitem">{{ $t("nav.mine") }}</RouterLink>
      <RouterLink :to="lp('/wallet')" class="menu__item" role="menuitem">{{ $t("nav.wallet") }}</RouterLink>
      <div class="menu__rule" />
      <button class="menu__item" role="menuitem" @click="session.logout()">{{ $t("nav.logout") }}</button>
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
.acct__credits svg { width: 13px; height: 13px; fill: var(--gold); }

.acct__btn { padding: 2px; background: none; border: 0; border-radius: var(--r-pill); cursor: pointer; display: inline-flex; }
.acct__btn:hover { background: var(--surface-2); }
.acct__face { width: 30px; height: 30px; border-radius: var(--r-pill); object-fit: cover; }
.acct__face--void { display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font-size: 13px; font-weight: 600; }

.menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
  min-width: 200px; padding: 6px;
  box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  animation: fade var(--dur) var(--ease);
}
.menu__head { display: grid; gap: 2px; padding: 8px 10px 10px; }
.menu__name { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu__plan { width: fit-content; padding: 1px 7px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 600; }
.menu__item {
  display: block; width: 100%; padding: 8px 10px; text-align: left;
  background: none; border: 0; border-radius: var(--r-sm);
  font-size: 13.5px; color: var(--text); cursor: pointer;
}
.menu__item:hover { background: var(--surface-2); }
.menu__rule { height: 1px; margin: 6px 4px; background: var(--line); }
@keyframes fade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
</style>
