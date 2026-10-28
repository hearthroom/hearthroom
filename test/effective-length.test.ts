import { expect, it } from 'vitest';
import { effectiveCharacters, reviewLength } from '../src/review-length';

it('counts Unicode letters and numbers with NFC; excludes all punctuation, whitespace, symbols and emoji', () => {
  expect(effectiveCharacters('中 文，。！ ABC def 123 １２３\n💜 + - _')).toBe(14);
  expect(effectiveCharacters('é e\u0301 가 𠮷')).toBe(4);
});
it('removes markup, attributes, script/style, variables, image text and link destinations; decodes entities once', () => {
  expect(effectiveCharacters('<p title="fake">真<b>字</b></p><!-- hidden --><script>fake()</script><style>.fake{}</style>')).toBe(2);
  expect(effectiveCharacters('{{char}} {{char}} ${user} [文字](https://example.test) ![image](https://img.test) &nbsp; &amp; &#20013; &eacute;')).toBe(4);
  expect(effectiveCharacters('[內容][ref]\n\n[ref]: https://example.test')).toBe(2);
});
it.each([2999, 3000, 3001])('uses only persona and enabled constant contents with a strict >3000 threshold (%i)', total => {
  const result = reviewLength({document: {roleDetailDesc: 'a'.repeat(total - 1000), customInstructions: 'x'.repeat(5000), talkExample: 'x'.repeat(5000)},
    greetings: {welcome: '開場白'}, worldbooks: [{name: '不計', entries: [
      {content: '中'.repeat(1000), isConstant: true, isEnabled: true},
      {content: 'x'.repeat(9999), isConstant: true, isEnabled: false},
      {content: 'x'.repeat(9999), isConstant: false, isEnabled: true}]}]});
  expect(result).toEqual({persona: total-1000, constantWorldbook: 1000, total, required: 3001, remaining: Math.max(0, 3001-total), eligible: total>3000, welcome: 3});
});
it('does not double count the first book alias and supports older single-book snapshots', () => {
  const book = {entries: [{content: '常駐', isConstant: true}]};
  expect(reviewLength({worldbooks: [book], worldbook: book}).constantWorldbook).toBe(2);
  expect(reviewLength({worldbook: book}).constantWorldbook).toBe(2);
});
