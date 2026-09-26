/**
 * 瀏覽器外框染色的實驗面板（?tintLab=1）。
 *
 * iOS 26 起的 Safari 不看 theme-color，但網路上整理的取樣規則在 owner 的 iPhone 上兩條都不成立
 * （2026-09-26：html 背景塗色後頂部反而不染色、底邊 3px 細條沒被採用；三張截圖的頂部與底部
 * 都是 Safari 沒染色時的 (15,17,22)）。這個面板讓人在手機上即時切換做法、截圖比對，
 * 確定 Safari 實際認哪一種之後就拿掉或只留結論。
 *
 * 只在網址帶 tintLab=1 時出現；其餘情況完全不動。
 */
type Paint = (doc: Document, top: string | null, bottom?: string | null) => void;

const VARIANTS = [
  ['0', 'shipped', '目前上線'],
  ['1', 'off', '全關'],
  ['2', 'html', 'html 背景'],
  ['3', 'body', 'body 背景'],
  ['4', 'root', '畫布根底色'],
  ['5', 'probes', '細條（現行）'],
  ['6', 'probes-jahir', '細條（文章寫法）'],
  ['7', 'root-single', '畫布根＋底部同頂'],
] as const;
type Variant = (typeof VARIANTS)[number][1];

const LAB_ATTR = 'data-tint-lab';

export function tintLabEnabled(): boolean {
  try { return new URLSearchParams(location.search).get('tintLab') === '1'; } catch { return false; }
}

export function createTintLab(paint: Paint | undefined) {
  let variant: Variant = 'shipped';
  let top: string | null = null;
  let bottom: string | null | undefined;
  let panel: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  const doc = document;

  const clear = () => {
    paint?.(doc, null);
    doc.querySelectorAll(`[${LAB_ATTR}="probe"]`).forEach((el) => el.remove());
    doc.documentElement.style.removeProperty('background-color');
    doc.body.style.removeProperty('background-color');
    doc.querySelector<HTMLElement>('.canvas-root')?.style.removeProperty('background-color');
  };
  const probe = (edge: 'top' | 'bottom', color: string, jahir: boolean) => {
    const el = doc.createElement('div');
    el.setAttribute(LAB_ATTR, 'probe');
    el.style.cssText = jahir
      ? `position:fixed;left:0;width:100%;${edge}:-8px;min-height:12px;z-index:2147483000;background-color:${color}`
      : `position:fixed;left:0;right:0;${edge}:0;height:3px;pointer-events:none;z-index:1;background-color:${color}`;
    if (!jahir) el.setAttribute('aria-hidden', 'true');
    if (jahir) doc.body.insertBefore(el, doc.body.firstChild);
    else doc.body.appendChild(el);
  };
  const apply = () => {
    clear();
    const b = bottom ?? top;
    if (top) {
      const root = doc.querySelector<HTMLElement>('.canvas-root');
      switch (variant) {
        case 'shipped': paint?.(doc, top, bottom); break;
        case 'off': break;
        case 'html': doc.documentElement.style.setProperty('background-color', top); break;
        case 'body': doc.body.style.setProperty('background-color', top); break;
        case 'root': root?.style.setProperty('background-color', top); if (b && b !== top) probe('bottom', b, false); break;
        case 'probes': probe('top', top, false); if (b) probe('bottom', b, false); break;
        case 'probes-jahir': probe('top', top, true); if (b) probe('bottom', b, true); break;
        case 'root-single': root?.style.setProperty('background-color', top); break;
      }
    }
    if (status) status.textContent = `${variant}\ntop ${top ?? '-'}\nbottom ${bottom ?? '-'}\n改完請捲動一下再截圖`;
    panel?.querySelectorAll('button').forEach((btn) => { btn.style.outline = btn.dataset.variant === variant ? '2px solid #fff' : 'none'; });
  };
  const mount = () => {
    if (panel || !doc.body) return;
    panel = doc.createElement('div');
    panel.setAttribute(LAB_ATTR, 'panel');
    panel.style.cssText = 'position:fixed;right:4px;top:30%;z-index:2147483600;display:flex;flex-direction:column;gap:4px;padding:6px;background:rgba(0,0,0,.72);color:#fff;font:12px/1.3 system-ui;border-radius:8px;max-width:150px';
    for (const [n, v, label] of VARIANTS) {
      const btn = doc.createElement('button');
      btn.dataset.variant = v;
      btn.textContent = `${n} ${label}`;
      btn.style.cssText = 'all:unset;cursor:pointer;padding:4px 6px;border-radius:6px;background:rgba(255,255,255,.14);text-align:left';
      btn.addEventListener('click', () => { variant = v; apply(); });
      panel.appendChild(btn);
    }
    status = doc.createElement('pre');
    status.style.cssText = 'margin:4px 0 0;white-space:pre-wrap;font:10px/1.3 ui-monospace,monospace';
    panel.appendChild(status);
    doc.body.appendChild(panel);
  };
  return {
    update(nextTop: string | null, nextBottom?: string | null) {
      top = nextTop;
      bottom = nextBottom;
      if (top) mount();
      else { panel?.remove(); panel = null; status = null; }
      apply();
    },
  };
}

export type TintLab = ReturnType<typeof createTintLab>;
