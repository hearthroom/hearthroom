import {createApp,h,nextTick,ref,type App} from 'vue';
import {afterEach,expect,it,vi} from 'vitest';
import ActionToast from '../src/components/ActionToast.vue';
let app:App,el:HTMLDivElement;
afterEach(()=>{app?.unmount();el?.remove();vi.useRealTimers();});
it('keeps an undo action available while focused and pauses expiry during a pending mutation',async()=>{
 vi.useFakeTimers();const dismiss=vi.fn(),action=vi.fn(),busy=ref(false);
 el=document.createElement('div');document.body.append(el);app=createApp({render:()=>h(ActionToast,{message:'已移除',actionLabel:'復原',busy:busy.value,onDismiss:dismiss,onAction:action})});app.mount(el);await nextTick();
 const box=el.querySelector('div')!,button=el.querySelector('button')!;
 box.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));await vi.advanceTimersByTimeAsync(10000);expect(dismiss).not.toHaveBeenCalled();
 button.click();expect(action).toHaveBeenCalledOnce();busy.value=true;await nextTick();
 box.dispatchEvent(new FocusEvent('focusout',{bubbles:true,relatedTarget:document.body}));await vi.advanceTimersByTimeAsync(10000);expect(dismiss).not.toHaveBeenCalled();expect(button.disabled).toBe(true);
 busy.value=false;await nextTick();await vi.advanceTimersByTimeAsync(6000);expect(dismiss).toHaveBeenCalledOnce();
});
