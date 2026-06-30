import { atom } from 'nanostores';
import { persistentAtom } from '@nanostores/persistent';

/**
 * Client-side state for cart, wishlist, and ephemeral UI overlays.
 *
 * Cart and wishlist persist to localStorage (in the browser) via @nanostores/persistent;
 * in Node (tests) the library falls back to an in-memory object. UI state is ephemeral.
 *
 * Vanilla scripts in the islands subscribe to these stores and update the DOM.
 */

export interface CartItem {
  slug: string;
  qty: number;
}
export interface CartState {
  items: CartItem[];
}

const json = { encode: JSON.stringify, decode: JSON.parse };

export const $cart = persistentAtom<CartState>('rr:cart', { items: [] }, json);
export const $wishlist = persistentAtom<string[]>('rr:wishlist', [], json);

export interface UiState {
  cartOpen: boolean;
  mobileMenuOpen: boolean;
  filtersOpen: boolean;
}
export const $ui = atom<UiState>({ cartOpen: false, mobileMenuOpen: false, filtersOpen: false });

/* ---- Pure helpers (no store access — easy to test & reuse) ---- */

export function cartCount(items: CartItem[]): number {
  return items.reduce((n, i) => n + i.qty, 0);
}

export function cartSubtotal(items: CartItem[], priceOf: (slug: string) => number): number {
  return items.reduce((sum, i) => sum + priceOf(i.slug) * i.qty, 0);
}

/* ---- Cart actions ---- */

export function addToCart(slug: string, qty = 1): void {
  const items = $cart.get().items;
  const existing = items.find((i) => i.slug === slug);
  const next = existing
    ? items.map((i) => (i.slug === slug ? { ...i, qty: i.qty + qty } : i))
    : [...items, { slug, qty }];
  $cart.set({ items: next });
}

export function setQty(slug: string, qty: number): void {
  const next = $cart
    .get()
    .items.map((i) => (i.slug === slug ? { ...i, qty } : i))
    .filter((i) => i.qty > 0);
  $cart.set({ items: next });
}

export function removeFromCart(slug: string): void {
  $cart.set({ items: $cart.get().items.filter((i) => i.slug !== slug) });
}

export function clearCart(): void {
  $cart.set({ items: [] });
}

/* ---- Wishlist actions ---- */

export function toggleWishlist(slug: string): void {
  const w = $wishlist.get();
  $wishlist.set(w.includes(slug) ? w.filter((s) => s !== slug) : [...w, slug]);
}

export function isWishlisted(slug: string): boolean {
  return $wishlist.get().includes(slug);
}

/* ---- UI actions ---- */

export function openCart(): void {
  $ui.set({ ...$ui.get(), cartOpen: true });
}
export function closeCart(): void {
  $ui.set({ ...$ui.get(), cartOpen: false });
}
export function setMenu(open: boolean): void {
  $ui.set({ ...$ui.get(), mobileMenuOpen: open });
}
export function setFilters(open: boolean): void {
  $ui.set({ ...$ui.get(), filtersOpen: open });
}
