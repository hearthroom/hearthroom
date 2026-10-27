import { afterEach, expect, it, vi } from 'vitest';
import { SukiPet, type PetOptions } from '../src/pet/pet-ui';
let pet: SukiPet;
afterEach(() => { pet?.stop(); vi.restoreAllMocks(); });
it('suppresses unverified list-end events without consuming the later successful event', () => {
  let allowed = false;
  pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 220, line: key => key, canListEnd: () => allowed } as PetOptions);
  const act = vi.spyOn(pet as unknown as { act: (...args: unknown[]) => void }, 'act').mockImplementation(() => {});
  pet.on({ type: 'listEnd' }); expect(act).not.toHaveBeenCalled();
  allowed = true; pet.on({ type: 'listEnd' }); expect(act).toHaveBeenCalledTimes(1);
});
it('drops queued list-end speech when the list starts loading or fails before speech can run', () => {
  let allowed = true;
  pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 220, line: key => key, canListEnd: () => allowed } as PetOptions);
  const queued: unknown[] = [];
  const act = vi.spyOn(pet as unknown as { act: (value: unknown) => void }, 'act').mockImplementation(value => { queued.push(value); });
  pet.on({ type: 'listEnd' }); act.mockRestore(); allowed = false;
  (pet as unknown as { driver: { state: { talking: boolean } } }).driver = { state: { talking: false } };
  const speak = vi.spyOn(pet as unknown as { speak: (...args: unknown[]) => void }, 'speak').mockImplementation(() => {});
  (pet as unknown as { act: (value: unknown) => void }).act(queued[0]);
  expect(speak).not.toHaveBeenCalled();
});

it('does not carry a list-end condition into unrelated direct speech', () => {
  pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 220, line: key => key } as PetOptions);
  const internals = pet as unknown as { bubbleCondition: (() => boolean) | undefined; speak: (text: string) => void; fitPopups: () => void };
  internals.bubbleCondition = () => false;
  vi.spyOn(internals, 'fitPopups').mockImplementation(() => {});
  internals.speak('Zzz…');
  expect(internals.bubbleCondition).toBeUndefined();
});
