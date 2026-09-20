import { afterEach, expect, it } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import ResourceSelect from '../src/components/ResourceSelect.vue';
let app: App, root: HTMLElement;
const setup = async (disabled = false) => {
 const value = ref<string | number>(24);
 root = document.createElement('div'); document.body.append(root);
 app = createApp({setup:()=>()=>h(ResourceSelect, {modelValue:value.value, 'onUpdate:modelValue':v=>value.value=v,label:'Page size',disabled,options:[{value:24,label:'24 per page'},{value:48,label:'48 per page'},{value:96,label:'96 per page'}]})});
 app.mount(root); await nextTick();
 return value;
};
afterEach(()=>{ app?.unmount(); root?.remove(); });
it('supports keyboard selection while preserving numeric values and focus', async()=>{
 const value=await setup(); const trigger=root.querySelector('button')!;
 trigger.focus(); trigger.click(); await nextTick();
 expect(root.querySelector('[role=listbox]')).not.toBeNull();
 trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
 trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await nextTick();
 expect(value.value).toBe(48); expect(document.activeElement).toBe(trigger);
 expect(root.querySelector('[role=listbox]')).toBeNull();
});
it('dismisses with Escape or outside click without changing selection', async()=>{
 const value=await setup(); const trigger=root.querySelector('button')!;
 trigger.click(); await nextTick();
 trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
 trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await nextTick();
 expect(value.value).toBe(24); expect(trigger.getAttribute('aria-expanded')).toBe('false');
 trigger.click(); await nextTick(); document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); await nextTick();
 expect(root.querySelector('[role=listbox]')).toBeNull();
});
it('does not open when disabled', async()=>{
 await setup(true); const trigger=root.querySelector('button')!;
 expect(trigger.disabled).toBe(true); trigger.click(); await nextTick();
 expect(root.querySelector('[role=listbox]')).toBeNull();
});
