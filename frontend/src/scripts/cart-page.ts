import { $cart, setQty, removeFromCart } from '../lib/stores';
import { formatPrice } from '../lib/format';

/** Full-page cart renderer (reads the $cart store + embedded product lookup). */
interface Entry {
  name: string;
  subtitle: string;
  price: number;
  href: string;
  img: string | null;
  alt: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function init(): void {
  const lookupEl = document.querySelector<HTMLElement>('[data-cart-page-lookup]');
  if (!lookupEl) return;
  const lookup: Record<string, Entry> = JSON.parse(lookupEl.textContent || '{}');

  const emptyEl = document.querySelector<HTMLElement>('[data-cart-empty]');
  const contentEl = document.querySelector<HTMLElement>('[data-cart-content]');
  const linesEl = document.querySelector<HTMLElement>('[data-cart-lines]');
  const subtotalEl = document.querySelector<HTMLElement>('[data-cart-subtotal]');
  const totalEl = document.querySelector<HTMLElement>('[data-cart-total]');
  const checkoutBtn = document.querySelector<HTMLElement>('[data-checkout]');
  const checkoutMsg = document.querySelector<HTMLElement>('[data-checkout-msg]');

  function render(): void {
    const items = $cart.get().items;
    const empty = items.length === 0;
    if (emptyEl) emptyEl.hidden = !empty;
    if (contentEl) contentEl.hidden = empty;
    if (empty) {
      if (linesEl) linesEl.innerHTML = '';
      return;
    }

    let subtotal = 0;
    const rows = items
      .map(({ slug, qty }) => {
        const p = lookup[slug];
        if (!p) return '';
        subtotal += p.price * qty;
        const thumb = p.img
          ? `<img src="${p.img}" alt="${escapeHtml(p.alt)}" width="96" height="128" class="w-24 h-32 object-cover shrink-0" loading="lazy" decoding="async" />`
          : `<div class="w-24 h-32 bg-surface-container shrink-0" aria-hidden="true"></div>`;
        return `
          <div class="flex gap-5 py-6 hairline-b">
            <a href="${p.href}" class="shrink-0">${thumb}</a>
            <div class="flex-1 flex flex-col min-w-0">
              <a href="${p.href}" class="font-display text-headline-sm leading-tight hover:opacity-70 transition-opacity">${escapeHtml(p.name)}</a>
              <span class="text-label-caps uppercase opacity-50 mt-1">${escapeHtml(p.subtitle)}</span>
              <div class="mt-auto flex items-center gap-6 pt-4">
                <div class="flex items-center border border-outline-variant">
                  <button type="button" data-qty-dec="${slug}" aria-label="Decrease quantity of ${escapeHtml(p.name)}" class="px-3 py-2 hover:bg-surface-container transition-colors">&#8722;</button>
                  <span class="text-body-md min-w-8 text-center" data-qty="${slug}">${qty}</span>
                  <button type="button" data-qty-inc="${slug}" aria-label="Increase quantity of ${escapeHtml(p.name)}" class="px-3 py-2 hover:bg-surface-container transition-colors">+</button>
                </div>
                <button type="button" data-remove="${slug}" class="text-caption underline opacity-50 hover:opacity-100 transition-opacity">Remove</button>
              </div>
            </div>
            <span class="text-body-md shrink-0">${formatPrice(p.price * qty)}</span>
          </div>`;
      })
      .join('');

    if (linesEl) linesEl.innerHTML = rows;
    if (subtotalEl) subtotalEl.textContent = formatPrice(subtotal);
    if (totalEl) totalEl.textContent = formatPrice(subtotal);
  }

  document.querySelector('[data-cart-lines]')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const inc = btn.getAttribute('data-qty-inc');
    const dec = btn.getAttribute('data-qty-dec');
    const rem = btn.getAttribute('data-remove');
    const qtyOf = (slug: string) => $cart.get().items.find((i) => i.slug === slug)?.qty ?? 0;
    if (inc) setQty(inc, qtyOf(inc) + 1);
    else if (dec) setQty(dec, qtyOf(dec) - 1);
    else if (rem) removeFromCart(rem);
  });

  checkoutBtn?.addEventListener('click', () => {
    if (checkoutMsg) checkoutMsg.hidden = false;
  });

  $cart.subscribe(render);
}

if (document.readyState !== 'loading') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
