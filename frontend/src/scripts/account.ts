/** Account-area client island: profile save, avatar upload, address add/delete/default. */
function init(): void {
  const root = document.querySelector('[data-account]');
  if (!root) return;
  const err = root.querySelector<HTMLElement>('[data-account-error]');

  function fail(message: string): void {
    if (err) { err.textContent = message; err.hidden = false; }
  }
  async function send(path: string, method: string, body?: BodyInit, headers?: Record<string, string>): Promise<Response> {
    const res = await fetch(`/api/account${path}`, { method, body, headers });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: 'Something went wrong' }));
      throw new Error(data.message ?? `Error ${res.status}`);
    }
    return res;
  }

  // Profile save
  root.querySelector<HTMLFormElement>('[data-profile-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (err) err.hidden = true;
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    try {
      await send('/profile', 'PATCH', JSON.stringify({ name: fd.get('name'), phone: fd.get('phone') }), { 'content-type': 'application/json' });
      window.location.reload();
    } catch (e2) { fail((e2 as Error).message); }
  });

  // Avatar upload
  root.querySelector<HTMLInputElement>('[data-avatar-input]')?.addEventListener('change', async (e) => {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files?.length) return;
    const fd = new FormData();
    fd.append('file', input.files[0]);
    try {
      await send('/avatar', 'POST', fd);
      window.location.reload();
    } catch (e2) { fail((e2 as Error).message); }
  });

  // Add address
  root.querySelector<HTMLFormElement>('[data-address-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (err) err.hidden = true;
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const payload: Record<string, unknown> = Object.fromEntries(fd.entries());
    payload.isDefault = fd.get('isDefault') === 'on';
    try {
      await send('/addresses', 'POST', JSON.stringify(payload), { 'content-type': 'application/json' });
      window.location.reload();
    } catch (e2) { fail((e2 as Error).message); }
  });

  // Request password change code
  root.querySelector<HTMLButtonElement>('[data-password-request]')?.addEventListener('click', async () => {
    if (err) err.hidden = true;
    const msg = root.querySelector<HTMLElement>('[data-password-msg]');
    try {
      await send('/password/request-code', 'POST');
      if (msg) { msg.textContent = 'Code sent — check the API server log (SMTP arrives later).'; msg.hidden = false; }
    } catch (e2) { fail((e2 as Error).message); }
  });

  // Submit password change
  root.querySelector<HTMLFormElement>('[data-password-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (err) err.hidden = true;
    const msg = root.querySelector<HTMLElement>('[data-password-msg]');
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const payload = { code: fd.get('code'), currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword') };
    try {
      await send('/password/change', 'POST', JSON.stringify(payload), { 'content-type': 'application/json' });
      if (msg) { msg.textContent = 'Password updated.'; msg.hidden = false; }
      (e.currentTarget as HTMLFormElement).reset();
    } catch (e2) { fail((e2 as Error).message); }
  });

  // Delete / set-default (event delegation)
  root.addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-address-action]');
    if (!t) return;
    e.preventDefault();
    const id = t.getAttribute('data-id');
    const action = t.getAttribute('data-address-action');
    try {
      if (action === 'delete') await send(`/addresses/${id}`, 'DELETE');
      else if (action === 'default') await send(`/addresses/${id}/default`, 'POST');
      window.location.reload();
    } catch (e2) { fail((e2 as Error).message); }
  });
}

if (document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init);
