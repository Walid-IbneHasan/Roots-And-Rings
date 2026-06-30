import { $ui, $cart, cartCount, openCart, closeCart, setMenu } from '../lib/stores';

/**
 * Orchestrates the overlay UI: cart drawer + mobile menu open/close, body scroll lock,
 * focus management, Esc to close, and the live cart-count badge + header scroll state.
 * Content rendering of the drawer lives in cart-drawer.ts.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

function init(): void {
  const header = document.querySelector<HTMLElement>('[data-header]');
  const menu = document.getElementById('mobile-menu');
  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-overlay');
  const badge = document.querySelector<HTMLElement>('[data-cart-count]');

  let lastFocused: HTMLElement | null = null;

  // --- wire triggers ---
  document.querySelectorAll('[data-cart-open]').forEach((b) => b.addEventListener('click', () => openCart()));
  document.querySelectorAll('[data-cart-close]').forEach((b) => b.addEventListener('click', () => closeCart()));
  overlay?.addEventListener('click', () => closeCart());

  document.querySelectorAll('[data-menu-open]').forEach((b) => b.addEventListener('click', () => setMenu(true)));
  document.querySelectorAll('[data-menu-close]').forEach((b) => b.addEventListener('click', () => setMenu(false)));
  menu?.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false)));

  // --- keyboard: Esc to close, Tab trap within the open overlay ---
  document.addEventListener('keydown', (e) => {
    const state = $ui.get();
    const active = state.cartOpen ? drawer : state.mobileMenuOpen ? menu : null;
    if (!active) return;

    if (e.key === 'Escape') {
      if (state.cartOpen) closeCart();
      if (state.mobileMenuOpen) setMenu(false);
      return;
    }
    if (e.key === 'Tab') {
      const items = Array.from(active.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // --- react to UI state ---
  $ui.subscribe((state) => {
    if (drawer && overlay) {
      drawer.classList.toggle('open', state.cartOpen);
      overlay.classList.toggle('open', state.cartOpen);
      drawer.setAttribute('aria-hidden', String(!state.cartOpen));
    }
    if (menu) {
      menu.classList.toggle('open', state.mobileMenuOpen);
      menu.setAttribute('aria-hidden', String(!state.mobileMenuOpen));
    }
    document
      .querySelectorAll('[data-menu-open]')
      .forEach((b) => b.setAttribute('aria-expanded', String(state.mobileMenuOpen)));

    const anyOpen = state.cartOpen || state.mobileMenuOpen || state.filtersOpen;
    document.documentElement.style.overflow = anyOpen ? 'hidden' : '';

    const focusTarget = state.cartOpen ? drawer : state.mobileMenuOpen ? menu : null;
    if (focusTarget) {
      if (!lastFocused) lastFocused = document.activeElement as HTMLElement;
      window.setTimeout(() => {
        focusTarget.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      }, 50);
    } else if (lastFocused && !state.cartOpen && !state.mobileMenuOpen) {
      lastFocused.focus?.();
      lastFocused = null;
    }
  });

  // --- live cart badge ---
  const renderBadge = () => {
    const n = cartCount($cart.get().items);
    if (!badge) return;
    badge.textContent = String(n);
    badge.style.display = n > 0 ? 'inline-flex' : 'none';
  };
  $cart.subscribe(renderBadge);

  // --- header scroll state (for flush/transparent header) ---
  const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 40);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

if (document.readyState !== 'loading') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
