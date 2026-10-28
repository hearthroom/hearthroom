<script setup lang="ts">
import type { RegexRuleSet, RuleIssue } from "@/lib/regex-rules";

defineProps<{ set: RegexRuleSet; issues: RuleIssue[] }>();
</script>

<template>
  <ul class="regex-issues">
    <li v-for="(issue, i) in issues" :key="i">
      <template v-if="issue.ruleId && set.rules.some(rule => rule.id === issue.ruleId)">
        {{ $t("regex.issue.rule", {
          index: set.rules.findIndex(rule => rule.id === issue.ruleId) + 1,
          name: set.rules.find(rule => rule.id === issue.ruleId)?.name.trim() || $t("regex.rule.untitled"),
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
