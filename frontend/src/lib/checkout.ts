import { $cart, clearCart } from './stores';
import { formatPrice } from './format';

interface Entry {
  name: string;
  subtitle: string;
  price: number;
  href: string;
  img: string | null;
  alt: string;
}

const CHECKOUT_URL = '/api/checkout';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function init(): void {
  const root = document.querySelector<HTMLElement>('[data-checkout]');
  if (!root) return;
  const lookupEl = root.querySelector<HTMLElement>('[data-checkout-lookup]');
  const lookup: Record<string, Entry> = lookupEl ? JSON.parse(lookupEl.textContent || '{}') : {};
  const summaryEl = root.querySelector<HTMLElement>('[data-checkout-summary]');
  const totalEl = root.querySelector<HTMLElement>('[data-checkout-total]');
  const form = root.querySelector<HTMLFormElement>('form[data-checkout-form]');
  const emptyEl = root.querySelector<HTMLElement>('[data-checkout-empty]');
  const contentEl = root.querySelector<HTMLElement>('[data-checkout-content]');
  const errorEl = root.querySelector<HTMLElement>('[data-checkout-error]');
  const submitBtn = root.querySelector<HTMLButtonElement>('[data-checkout-submit]');
  const couponInput = root.querySelector<HTMLInputElement>('[data-coupon-input]');
  const couponApply = root.querySelector<HTMLButtonElement>('[data-coupon-apply]');
  const couponMsg = root.querySelector<HTMLElement>('[data-coupon-msg]');
  const couponRow = root.querySelector<HTMLElement>('[data-coupon-row]');
  const couponCodeEl = root.querySelector<HTMLElement>('[data-coupon-code]');
  const couponAmountEl = root.querySelector<HTMLElement>('[data-coupon-amount]');
  let appliedCoupon: { code: string; discount: number } | null = null;

  function renderSummary(): void {
    const items = $cart.get().items;
    const empty = items.length === 0;
    if (emptyEl) emptyEl.hidden = !empty;
    if (contentEl) contentEl.hidden = empty;
    if (empty) {
      if (summaryEl) summaryEl.innerHTML = '';
      return;
    }
    let subtotal = 0;
    if (summaryEl) {
      summaryEl.innerHTML = items
        .map(({ slug, qty }) => {
          const p = lookup[slug];
          if (!p) return '';
          subtotal += p.price * qty;
          const thumb = p.img
            ? `<img src="${p.img}" alt="" class="w-16 h-20 object-cover shrink-0" />`
            : `<div class="w-16 h-20 bg-surface-container shrink-0"></div>`;
          return `<div class="flex gap-4 py-4 hairline-b">${thumb}<div class="flex-1 min-w-0"><p class="font-display text-body-lg leading-tight">${escapeHtml(p.name)}</p><span class="text-label-caps uppercase opacity-50">Qty ${qty}</span></div><span class="text-body-md">${formatPrice(p.price * qty)}</span></div>`;
        })
        .join('');
    }
    const discount = appliedCoupon ? Math.min(appliedCoupon.discount, subtotal) : 0;
    if (couponRow) couponRow.hidden = !appliedCoupon;
    if (appliedCoupon && couponCodeEl) couponCodeEl.textContent = appliedCoupon.code;
    if (appliedCoupon && couponAmountEl) couponAmountEl.textContent = `−${formatPrice(discount)}`;
    if (totalEl) totalEl.textContent = formatPrice(Math.max(subtotal - discount, 0));
  }

  function idemKey(): string {
    let k = sessionStorage.getItem('rr_checkout_idem');
    if (!k) {
      k = crypto.randomUUID();
      sessionStorage.setItem('rr_checkout_idem', k);
    }
    return k;
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errorEl) errorEl.hidden = true;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const items = $cart.get().items;
    if (!items.length) return;
    const fd = new FormData(form);
    const payload = {
      items: items.map((i) => ({ slug: i.slug, qty: i.qty })),
      contact: { name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone') },
      shipping: {
        line1: fd.get('line1'),
        line2: fd.get('line2') || undefined,
        city: fd.get('city'),
        district: fd.get('district'),
        postalCode: fd.get('postalCode') || undefined,
      },
      paymentMethod: fd.get('paymentMethod') || 'COD',
      idempotencyKey: idemKey(),
      ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}),
    };

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Placing order…';
    }
    try {
      const res = await fetch(CHECKOUT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: 'Checkout failed' }))) as { message?: string };
        throw new Error(err.message || `Checkout failed (${res.status})`);
      }
      const data = (await res.json()) as { orderNumber: string; orderToken: string; redirectUrl?: string; credentialsMissing?: boolean };
      if (data.credentialsMissing) {
        sessionStorage.removeItem('rr_checkout_idem');
        throw new Error('bKash is not configured yet — please choose Cash on Delivery.');
      }
      sessionStorage.removeItem('rr_checkout_idem');
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      clearCart();
      window.location.href = `/checkout/success?order=${encodeURIComponent(data.orderNumber)}&token=${encodeURIComponent(data.orderToken)}`;
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = (err as Error).message;
        errorEl.hidden = false;
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Place Order';
      }
    }
  });

  couponApply?.addEventListener('click', async () => {
    const code = couponInput?.value.trim();
    if (!code) return;
    const items = $cart.get().items.map((i) => ({ slug: i.slug, qty: i.qty }));
    if (!items.length) return;
    if (couponMsg) couponMsg.hidden = true;
    couponApply.disabled = true;
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, items }),
      });
      const data = await res.json();
      if (data.valid) {
        appliedCoupon = { code: data.code, discount: data.discount };
        if (couponMsg) {
          couponMsg.textContent = 'Code applied.';
          couponMsg.className = 'text-caption text-secondary';
          couponMsg.hidden = false;
        }
      } else {
        appliedCoupon = null;
        if (couponMsg) {
          couponMsg.textContent = data.message ?? 'This code isn’t valid.';
          couponMsg.className = 'text-caption text-error';
          couponMsg.hidden = false;
        }
      }
      renderSummary();
    } catch {
      if (couponMsg) { couponMsg.textContent = 'Could not check that code.'; couponMsg.className = 'text-caption text-error'; couponMsg.hidden = false; }
    } finally {
      couponApply.disabled = false;
    }
  });

  $cart.subscribe(renderSummary);
}

if (document.readyState !== 'loading') {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}
