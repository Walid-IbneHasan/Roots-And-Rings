import { $wishlist, toggleWishlist } from '../lib/stores';

/**
 * Syncs every [data-wishlist] toggle button to the persisted wishlist store.
 * Uses event delegation so buttons added anywhere on the page work without re-binding.
 */
function sync(): void {
  const set = new Set($wishlist.get());
  document.querySelectorAll<HTMLElement>('[data-wishlist]').forEach((btn) => {
    const slug = btn.getAttribute('data-wishlist');
    if (!slug) return;
    const active = set.has(slug);
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.setAttribute('aria-label', active ? 'Remove from wishlist' : 'Add to wishlist');
  });
}

function init(): void {
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-wishlist]');
    if (!btn) return;
    e.preventDefault();
    const slug = btn.getAttribute('data-wishlist');
    if (slug) toggleWishlist(slug);
  });
  $wishlist.subscribe(sync);
}

if (document.readyState !== 'loading') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
