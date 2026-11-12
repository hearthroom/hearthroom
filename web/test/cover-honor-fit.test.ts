import { expect, it } from 'vitest';
import { fitCoverHonors } from '../src/lib/cover-honor-fit';
it('keeps all three when they fit within two rows', () => {
  expect(fitCoverHonors([70, 70, 70], 150, 4, 0, 28)).toEqual({ shown: 3, firstWidth: 150, lastWidth: 150 });
});
it('hides only the final period and reserves +1 beside a truncated second badge', () => {
  expect(fitCoverHonors([121, 121, 121], 107, 4, 30, 28)).toEqual({ shown: 2, firstWidth: 73, lastWidth: 75 });
});
it('includes the current-rank prefix and handles no honors', () => {
  expect(fitCoverHonors([100, 100, 100], 150, 4, 30, 28).shown).toBe(2);
  expect(fitCoverHonors([], 150, 4, 30, 28).shown).toBe(0);
});

it('keeps two long honors within two rows even with a current rank and R flag', () => {
  expect(fitCoverHonors([121, 121], 107, 4, 30, 28)).toEqual({ shown: 2, firstWidth: 73, lastWidth: 107 });
});
