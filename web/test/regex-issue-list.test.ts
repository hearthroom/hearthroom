import { afterEach, expect, it } from 'vitest';
import { createApp, h, type App } from 'vue';
import RegexIssueList from '../src/components/editor/RegexIssueList.vue';
import { i18n } from '../src/lib/i18n';
import { emptyRuleSet, makeRule, validateRuleSet } from '../src/lib/regex-rules';

let app: App;
let root: HTMLElement;
const oldLocale = i18n.global.locale.value;
afterEach(() => { app?.unmount(); root?.remove(); i18n.global.locale.value = oldLocale; });

it.each(['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko'] as const)('%s 保留空名稱、多個原因與整份問題', locale => {
  i18n.global.locale.value = locale;
  const set = emptyRuleSet();
  set.rules = [makeRule({ id: 'synthetic', name: '', find: '', replace: 'x'.repeat(256 * 1024 + 1) })];
  const issues = [...validateRuleSet(set), { ruleId: '', key: 'regex.issue.tooMany', params: { max: 500 } }];
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(RegexIssueList, { set, issues }) }).use(i18n);
  app.mount(root);
  const texts = [...root.querySelectorAll('li')].map(el => el.textContent?.trim());
  expect(texts).toEqual([
    i18n.global.t('regex.issue.rule', { index: 1, name: i18n.global.t('regex.rule.untitled'), why: i18n.global.t('regex.issue.emptyFind') }),
    i18n.global.t('regex.issue.rule', { index: 1, name: i18n.global.t('regex.rule.untitled'), why: i18n.global.t('regex.issue.replaceLong', { max: 256 }) }),
    i18n.global.t('regex.issue.tooMany', { max: 500 }),
  ]);
});
