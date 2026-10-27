import { afterEach, expect, it } from 'vitest';
import { navigateMenu } from '../src/lib/menu-navigation';
afterEach(() => { document.body.innerHTML = ''; });
it('enters the last visible row with ArrowUp from the opener and skips collapsed links', () => {
  const trigger = document.createElement('button');
  const panel = document.createElement('div');
  panel.innerHTML = '<a href="/first">First</a><details><summary>More</summary><a href="/hidden">Hidden</a></details><button>Last</button>';
  document.body.append(trigger, panel); trigger.focus();
  navigateMenu(new KeyboardEvent('keydown', { key: 'ArrowUp' }), panel);
  expect(document.activeElement?.textContent).toBe('Last');
  trigger.focus();navigateMenu(new KeyboardEvent('keydown', { key: 'ArrowDown' }), panel);
  expect(document.activeElement?.textContent).toBe('First');
});
