import { $cart, setQty, removeFromCart } from '../lib/stores';
import { formatPrice } from '../lib/format';

/**
 * Renders cart drawer line items reactively from the $cart store using a build-time
 * product lookup embedded as JSON. Open/close + a11y is handled by header.ts.
 */
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
  const drawer = document.getElementById('cart-drawer');
  if (!drawer) return;

  const itemsEl = drawer.querySelector<HTMLElement>('[data-cart-items]');
  const emptyEl = drawer.querySelector<HTMLElement>('[data-cart-empty]');
  const footerEl = drawer.querySelector<HTMLElement>('[data-cart-footer]');
  const subtotalEl = drawer.querySelector<HTMLElement>('[data-cart-subtotal]');
  const titleEl = drawer.querySelector<HTMLElement>('[data-cart-title]');
  const lookupEl = drawer.querySelector<HTMLElement>('[data-cart-lookup]');
  const lookup: Record<string, Entry> = lookupEl ? JSON.parse(lookupEl.textContent || '{}') : {};

  function render(): void {
    const items = $cart.get().items;
    const count = items.reduce((n, i) => n + i.qty, 0);
    if (titleEl) titleEl.textContent = count > 0 ? `Your Bag (${count})` : 'Your Bag';

    const empty = items.length === 0;
    if (emptyEl) emptyEl.hidden = !empty;
    if (itemsEl) itemsEl.hidden = empty;
    if (footerEl) footerEl.hidden = empty;
    if (empty) {
      if (itemsEl) itemsEl.innerHTML = '';
      return;
    }

    let subtotal = 0;
    const rows = items
      .map(({ slug, qty }) => {
        const p = lookup[slug];
        if (!p) return '';
        subtotal += p.price * qty;
        const thumb = p.img
          ? `<img src="${p.img}" alt="${escapeHtml(p.alt)}" width="80" height="100" class="w-20 h-24 object-cover shrink-0" loading="lazy" decoding="async" />`
          : `<div class="w-20 h-24 bg-surface-container shrink-0" aria-hidden="true"></div>`;
        return `
          <div class="flex gap-4 py-5 hairline-b">
            ${thumb}
            <div class="flex-1 flex flex-col min-w-0">
              <a href="${p.href}" class="font-display text-body-lg leading-tight hover:opacity-70 transition-opacity">${escapeHtml(p.name)}</a>
              <span class="text-label-caps uppercase opacity-50 mt-1">${escapeHtml(p.subtitle)}</span>
              <div class="mt-auto flex items-center justify-between pt-3">
                <div class="flex items-center border border-outline-variant">
                  <button type="button" data-qty-dec="${slug}" aria-label="Decrease quantity of ${escapeHtml(p.name)}" class="px-2.5 py-1.5 hover:bg-surface-container transition-colors">&#8722;</button>
                  <span class="text-body-md min-w-6 text-center" data-qty="${slug}">${qty}</span>
                  <button type="button" data-qty-inc="${slug}" aria-label="Increase quantity of ${escapeHtml(p.name)}" class="px-2.5 py-1.5 hover:bg-surface-container transition-colors">+</button>
                </div>
                <span class="text-body-md">${formatPrice(p.price * qty)}</span>
              </div>
              <button type="button" data-remove="${slug}" class="text-caption underline opacity-50 hover:opacity-100 transition-opacity mt-3 self-start">Remove</button>
            </div>
          </div>`;
      })
      .join('');

    if (itemsEl) itemsEl.innerHTML = rows;
    if (subtotalEl) subtotalEl.textContent = formatPrice(subtotal);
  }

  itemsEl?.addEventListener('click', (e) => {
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

  $cart.subscribe(render);
}

if (document.readyState !== 'loading') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
