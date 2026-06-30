import { beforeEach, describe, it, expect } from 'vitest';
import {
  $cart,
  $wishlist,
  addToCart,
  removeFromCart,
  setQty,
  clearCart,
  toggleWishlist,
  isWishlisted,
  cartCount,
  cartSubtotal,
} from '../src/lib/stores';

beforeEach(() => {
  clearCart();
  $wishlist.set([]);
});

describe('cart actions', () => {
  it('adds an item to the cart', () => {
    addToCart('the-kura-vessel');
    expect($cart.get().items).toEqual([{ slug: 'the-kura-vessel', qty: 1 }]);
  });

  it('increments quantity when adding the same item twice', () => {
    addToCart('the-kura-vessel');
    addToCart('the-kura-vessel', 2);
    expect($cart.get().items).toEqual([{ slug: 'the-kura-vessel', qty: 3 }]);
  });

  it('keeps distinct items separate', () => {
    addToCart('the-kura-vessel');
    addToCart('tsuki-basin');
    expect($cart.get().items.length).toBe(2);
  });

  it('setQty updates a quantity', () => {
    addToCart('the-kura-vessel');
    setQty('the-kura-vessel', 5);
    expect($cart.get().items[0].qty).toBe(5);
  });

  it('setQty to 0 removes the item', () => {
    addToCart('the-kura-vessel');
    setQty('the-kura-vessel', 0);
    expect($cart.get().items).toEqual([]);
  });

  it('removeFromCart removes the item', () => {
    addToCart('the-kura-vessel');
    addToCart('tsuki-basin');
    removeFromCart('the-kura-vessel');
    expect($cart.get().items).toEqual([{ slug: 'tsuki-basin', qty: 1 }]);
  });
});

describe('cart helpers', () => {
  it('cartCount sums quantities', () => {
    expect(cartCount([{ slug: 'a', qty: 2 }, { slug: 'b', qty: 3 }])).toBe(5);
  });

  it('cartSubtotal multiplies price by quantity', () => {
    const priceOf = (slug: string) => ({ a: 100, b: 50 }[slug] ?? 0);
    expect(cartSubtotal([{ slug: 'a', qty: 2 }, { slug: 'b', qty: 1 }], priceOf)).toBe(250);
  });
});

describe('wishlist', () => {
  it('toggles a slug on and off', () => {
    toggleWishlist('the-kura-vessel');
    expect(isWishlisted('the-kura-vessel')).toBe(true);
    toggleWishlist('the-kura-vessel');
    expect(isWishlisted('the-kura-vessel')).toBe(false);
  });
});
