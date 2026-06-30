/** Product-page review island: checks eligibility (logged-in only) and submits the review form. */
function init(): void {
  const root = document.querySelector<HTMLElement>('[data-reviews]');
  if (!root) return;
  const slug = root.getAttribute('data-slug');
  const loggedIn = root.getAttribute('data-logged-in') === 'true';
  const formWrap = root.querySelector<HTMLElement>('[data-review-form-wrap]');
  const stateEl = root.querySelector<HTMLElement>('[data-review-state]');
  const form = root.querySelector<HTMLFormElement>('[data-review-form]');
  const errEl = root.querySelector<HTMLElement>('[data-review-error]');
  if (!slug || !loggedIn) return; // signed-out copy is rendered server-side

  fetch(`/api/account/reviews/can-review?slug=${encodeURIComponent(slug)}`)
    .then((r) => (r.ok ? r.json() : { eligible: false, review: null }))
    .then((data: { eligible: boolean; review: { rating: number; title: string | null; body: string | null } | null }) => {
      if (!data.eligible) {
        if (stateEl) { stateEl.textContent = 'You can review this once your order has been delivered.'; stateEl.hidden = false; }
        return;
      }
      if (formWrap) formWrap.hidden = false;
      if (data.review && form) {
        const r = form.querySelector<HTMLSelectElement>('[name="rating"]');
        const t = form.querySelector<HTMLInputElement>('[name="title"]');
        const b = form.querySelector<HTMLTextAreaElement>('[name="body"]');
        if (r) r.value = String(data.review.rating);
        if (t && data.review.title) t.value = data.review.title;
        if (b && data.review.body) b.value = data.review.body.replace(/<[^>]*>/g, '');
        const heading = root.querySelector<HTMLElement>('[data-review-form-heading]');
        if (heading) heading.textContent = 'Edit your review';
      }
    })
    .catch(() => {});

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (errEl) errEl.hidden = true;
    const fd = new FormData(form);
    const payload = {
      productSlug: slug,
      rating: Number(fd.get('rating')),
      title: (fd.get('title') as string) || undefined,
      body: (fd.get('body') as string) || undefined,
    };
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = 'Submitting…'; }
    try {
      const res = await fetch('/api/account/reviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ message: 'Could not submit your review.' }))) as { message?: string };
        throw new Error(err.message ?? 'Could not submit your review.');
      }
      window.location.reload();
    } catch (err) {
      if (errEl) { errEl.textContent = (err as Error).message; errEl.hidden = false; }
      if (submit) { submit.disabled = false; submit.textContent = 'Submit review'; }
    }
  });
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
