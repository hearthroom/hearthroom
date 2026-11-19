<script setup lang="ts">
import { computed } from "vue";
import type { RegexRuleSet, RuleIssue } from "@/lib/regex-rules";

const props = defineProps<{ set: RegexRuleSet; issues: RuleIssue[] }>();

const rows = computed(() => props.issues.map(issue => {
  const index = issue.ruleIndex ?? (issue.ruleId ? props.set.rules.findIndex(rule => rule.id === issue.ruleId) : -1);
  const rule = props.set.rules[index];
  return { issue, rule, number: (rule?.sourceIndex ?? index) + 1 };
}));
</script>

<template>
  <ul class="regex-issues">
    <li v-for="({ issue, rule, number }, i) in rows" :key="i">
      <template v-if="rule">
        {{ $t("regex.issue.rule", {
          index: number,
          name: rule.name.trim() || $t("regex.rule.untitled"),
          why: $t(issue.key, issue.params ?? {}),
        }) }}
      </template>
      <template v-else>{{ $t(issue.key, issue.params ?? {}) }}</template>
    </li>
  </ul>
</template>

<style scoped>
.regex-issues { margin: var(--s-2) 0 0; padding-inline-start: var(--s-5); overflow-wrap: anywhere; }
</style>
