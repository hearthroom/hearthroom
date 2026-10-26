import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { baseParse } from '@vue/compiler-dom';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import FieldText from '../src/components/editor/FieldText.vue';
import ListEditor from '../src/components/editor/ListEditor.vue';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); document.body.innerHTML = ''; });
function mount(component: any, props: Record<string, unknown>) {
  const target = document.createElement('div'); document.body.append(target);
  const app = createApp({ render: () => h(component, props) }); app.mount(target);
  cleanups.push(() => app.unmount()); return target;
}

describe('non-personal text fields', () => {
  it.each([0, 4])('opts author fields out and keeps editing with rows=%s', async rows => {
    const updates: string[] = [];
    const root = mount(FieldText, { id: 'draft', label: 'Draft', modelValue: '', rows, 'onUpdate:modelValue': (v: string) => updates.push(v) });
    const field = root.querySelector('input,textarea') as HTMLInputElement;
    expect(field.autocomplete).toBe('off');
    field.value = 'Synthetic\ntext'; field.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick(); expect(updates).toEqual([field.value]);
  });

  it('opts alternative opening text out without changing its update', async () => {
    const updates: string[][] = [];
    const root = mount(ListEditor, { label: 'Openings', modelValue: [''], addLabel: 'Add', removeLabel: 'Remove', upLabel: 'Up', downLabel: 'Down', 'onUpdate:modelValue': (v: string[]) => updates.push(v) });
    const field = root.querySelector('textarea')!;
    expect(field.autocomplete).toBe('off');
    field.value = 'Synthetic opening'; field.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick(); expect(updates).toEqual([['Synthetic opening']]);
  });

  it('declares no contact completion for prose textareas, preserving the actual profile surface', () => {
    const src = resolve(process.cwd(), 'src');
    const failures: string[] = [];
    let checked = 0;
    for (const path of readdirSync(src, { recursive: true }) as string[]) {
      if (!path.endsWith('.vue') || path === 'components/profile/ProfileHero.vue') continue;
      const template = parseSfc(readFileSync(resolve(src, path), 'utf8')).descriptor.template;
      if (!template) continue;
      function visit(node: any) {
        if (node.type === 1 && node.tag === 'textarea') {
          checked++;
          if (!node.props.some((p: any) => p.type === 6 && p.name === 'autocomplete' && p.value?.content === 'off')) failures.push(`${path}:${node.loc.start.line}`);
        }
        node.children?.forEach(visit);
      }
      visit(baseParse(template.content));
    }
    expect(checked).toBeGreaterThan(20);
    expect(failures).toEqual([]);
  });
});
