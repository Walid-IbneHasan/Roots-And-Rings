import { $wishlist } from '../lib/stores';

/**
 * /wishlist page: every product is SSR-rendered as a hidden ProductCard wrapped in
 * [data-wishlist-card="<slug>"]. This island shows only the cards whose slug is in the
 * wishlist store, and toggles the empty state. The heart toggle itself is handled by the
 * global wishlist.ts island (document-delegated [data-wishlist]) — un-hearting a card here
 * mutates $wishlist, which re-runs render() and hides the card.
 */
function init(): void {
  const emptyEl = document.querySelector<HTMLElement>('[data-wishlist-empty]');
  const gridEl = document.querySelector<HTMLElement>('[data-wishlist-grid]');
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-wishlist-card]'));
  if (!gridEl) return;

  function render(): void {
    const set = new Set($wishlist.get());
    let shown = 0;
    for (const card of cards) {
      const slug = card.getAttribute('data-wishlist-card');
      const on = !!slug && set.has(slug);
      card.hidden = !on;
      if (on) shown++;
    }
    if (emptyEl) emptyEl.hidden = shown > 0;
    if (gridEl) gridEl.hidden = shown === 0;
  }

  $wishlist.subscribe(render);
}

if (document.readyState !== 'loading') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
