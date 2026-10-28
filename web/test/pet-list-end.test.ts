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
it('skips an invalid queued list-end and continues with the next notification after a menu closes', () => {
  vi.useFakeTimers();
  try {
    pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 220, line: key => key } as PetOptions);
    const internals = pet as unknown as { queue: unknown[]; menuEl: HTMLElement; driver: { state: { talking: boolean } }; closeMenu: () => void; speak: (...args: unknown[]) => void };
    internals.queue = [{ say: 'old listEnd', showIf: () => false }, { say: 'notification' }];
    internals.menuEl.hidden = false;
    internals.driver = { state: { talking: false } };
    const speak = vi.spyOn(internals, 'speak').mockImplementation(() => {});
    internals.closeMenu(); vi.advanceTimersByTime(401);
    expect(speak).toHaveBeenCalledWith('notification', undefined, undefined, undefined);
    expect(internals.queue).toHaveLength(0);
  } finally { vi.useRealTimers(); }
});

it('invalidates automatic speech carried into a quiet reading page and does not queue another automatic line there',()=>{
  let reading=false;
  pet=new SukiPet({base:'',skin:'day',label:'Suki',height:220,line:key=>key,quietReading:()=>reading} as PetOptions);
  const p=pet as unknown as {driver:{state:{talking:boolean}};speak:(text:string,ms?:number,action?:unknown,showIf?:()=>boolean)=>void;act:(value:{say:string})=>void};
  p.driver={state:{talking:false}};
  const speak=vi.spyOn(p,'speak').mockImplementation(()=>{});
  p.act({say:'A line from the previous page'});
  const condition=speak.mock.calls[0][3];expect(condition?.()).toBe(true);
  reading=true;expect(condition?.()).toBe(false);
  p.act({say:'A delayed daily line'});expect(speak).toHaveBeenCalledTimes(1);
});

it('keeps direct idle/sleep speech quiet while retaining an explicit requested line',()=>{
  let reading=true;
  pet=new SukiPet({base:'',skin:'day',label:'Suki',height:220,line:key=>key,quietReading:()=>reading} as PetOptions);
  const p=pet as unknown as {driver:{state:{talking:boolean}};bubble:HTMLElement;bubbleCondition?:()=>boolean;speak:(text:string)=>void;fitPopups:()=>void};
  p.driver={state:{talking:false}};vi.spyOn(p,'fitPopups').mockImplementation(()=>{});
  p.speak('sleepy');expect(p.bubble.hidden).toBe(true);
  reading=false;p.speak('Zzz…');expect(p.bubble.hidden).toBe(false);
  reading=true;expect(p.bubbleCondition?.()).toBe(false);
  pet.say('An explicitly requested explanation');expect(p.bubble.textContent).toBe('An explicitly requested explanation');expect(p.bubbleCondition?.()).toBe(true);
});
