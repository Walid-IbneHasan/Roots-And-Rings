import { $wishlist, toggleWishlist } from '../lib/stores';

/**
 * Syncs every [data-wishlist] toggle button to the persisted wishlist store, and — when the
 * visitor is signed in — keeps the account's wishlist in sync:
 *  - on load, POST the local slugs to /api/account/wishlist/merge. 200 ⇒ signed in: adopt the
 *    returned union (local guest items merge into the account). 401 ⇒ guest: stay local-only.
 *  - on toggle, write through (POST add / DELETE remove), best-effort.
 * Uses event delegation so buttons added anywhere on the page work without re-binding.
 */
let loggedIn = false;

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

async function syncOnLoad(): Promise<void> {
  try {
    const res = await fetch('/api/account/wishlist/merge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slugs: $wishlist.get() }),
    });
    if (res.ok) {
      loggedIn = true;
      const slugs: string[] = await res.json();
      $wishlist.set(slugs);
    }
  } catch {
    /* offline / network error — stay with the local list */
  }
}

async function writeThrough(slug: string, added: boolean): Promise<void> {
  if (!loggedIn) return;
  try {
    if (added) {
      await fetch('/api/account/wishlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
    } else {
      await fetch(`/api/account/wishlist/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    }
  } catch {
    /* best-effort — the local store already reflects the change */
  }
}

function init(): void {
  document.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-wishlist]');
    if (!btn) return;
    e.preventDefault();
    const slug = btn.getAttribute('data-wishlist');
    if (!slug) return;
    toggleWishlist(slug);
    void writeThrough(slug, $wishlist.get().includes(slug));
  });
  $wishlist.subscribe(sync);
  void syncOnLoad();
}

if (document.readyState !== 'loading') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
