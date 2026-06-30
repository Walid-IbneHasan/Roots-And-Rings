# Roots & Rings Phase 9 — Google login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Sign in with Google" — a GIS button that verifies a Google ID token server-side and logs the customer in via the existing JWT/`rr_session` session, creating or linking the account.

**Architecture:** Google Identity Services ID-token flow. Frontend button → BFF `/api/auth/google` → backend `POST /api/auth/google` verifies the token (`google-auth-library`), resolves the Customer (find-by-googleId / link-by-verified-email / create), returns the existing `{token, customer}`. No migration (`Customer.googleId` exists); no Client Secret.

**Tech Stack:** Backend — Fastify 5, Prisma + MySQL 8, zod, google-auth-library, Vitest. Frontend — Astro 5 SSR, Google Identity Services.

## Global Constraints

- **Branch `phase-9-google-login`**, normal per-task commits (Conventional Commits; end the body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).
- **Ampersand-path gotcha:** project in `D:\Roots & Rings` — `&` breaks `npm run`. Call node entrypoints directly (never `npm run`):
  - Backend tests: `cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run [tests/<file>]`
  - Frontend build: `cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build`
  - Frontend tests: `cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run`
- **`google-auth-library` is already installed** (backend) — do NOT npm install it.
- **Do NOT add other deps, do NOT run `astro check`.** Frontend tests live in `frontend/tests/`. The full frontend suite (51) needs a backend dev server UP (the controller keeps one running).
- **DB `rootsandrings-db` up** for backend tests.
- **The Client ID is `146901308187-merhd0hu1tlbudoc8ocse6dm86349aob.apps.googleusercontent.com`** (public — safe in client code/config). It is set in `backend/.env` (`GOOGLE_CLIENT_ID`) and `frontend/.env` (`PUBLIC_GOOGLE_CLIENT_ID`) by the controller — both `.env`s are gitignored, so do NOT commit them. (If `GOOGLE_CLIENT_ID` is absent the backend route still loads; if `PUBLIC_GOOGLE_CLIENT_ID` is absent the button renders nothing.)
- **DO NOT change the UI design.** Add the button below the existing forms; reuse existing classes.
- **Security:** the ID token is verified server-side (signature/audience/issuer/expiry via the library); `email_verified` is required; auto-link is by verified email only; Google-only accounts have `passwordHash = null` (the existing password-login route already returns 401 for them — no change needed).

---

### Task 1: Backend — Google verify + account resolution + route

**Files:**
- Modify: `backend/src/env.ts` (add `GOOGLE_CLIENT_ID`)
- Create: `backend/src/modules/auth/google.ts`
- Modify: `backend/src/modules/auth/routes.ts` (register the route)
- Test: `backend/tests/auth.google.test.ts`

**Interfaces:**
- Consumes: `signCustomerToken` (`../../lib/jwt`), `customerDto` (`./dto`), `httpError`, `env`, Prisma `Customer.googleId`.
- Produces: `interface GoogleProfile { sub: string; email: string; name?: string; emailVerified: boolean }`; `verifyGoogleIdToken(credential): Promise<GoogleProfile>`; `resolveGoogleCustomer(prisma, { sub, email, name }): Promise<Customer>`; `registerGoogleRoute(app, verify?)` → `POST /api/auth/google` returning `{ token, customer }`.

- [ ] **Step 1: Add the env var in `backend/src/env.ts`**

In the `z.object({ ... })`, add (near the other optional service vars):
```ts
  GOOGLE_CLIENT_ID: z.string().optional(),
```

- [ ] **Step 2: Write the failing test — `backend/tests/auth.google.test.ts`**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolveGoogleCustomer } from '../src/modules/auth/google';

const prisma = new PrismaClient();
const SUB1 = 'google-sub-zz-1';
const SUB2 = 'google-sub-zz-2';
const EMAIL_NEW = 'gnew-zz@test.com';
const EMAIL_LINK = 'glink-zz@test.com';

afterAll(async () => {
  await prisma.customer.deleteMany({ where: { email: { in: [EMAIL_NEW, EMAIL_LINK] } } });
  await prisma.$disconnect();
});

describe('resolveGoogleCustomer', () => {
  it('creates a new customer with googleId, verified email, and no password', async () => {
    const c = await resolveGoogleCustomer(prisma, { sub: SUB1, email: EMAIL_NEW, name: 'G New' });
    expect(c.googleId).toBe(SUB1);
    expect(c.email).toBe(EMAIL_NEW);
    expect(c.passwordHash).toBeNull();
    expect(c.emailVerifiedAt).not.toBeNull();
  });

  it('returns the same customer on a repeat googleId (no duplicate)', async () => {
    const again = await resolveGoogleCustomer(prisma, { sub: SUB1, email: EMAIL_NEW, name: 'G New' });
    expect(again.googleId).toBe(SUB1);
    const all = await prisma.customer.findMany({ where: { email: EMAIL_NEW } });
    expect(all.length).toBe(1);
  });

  it('links an existing password account by email (sets googleId, keeps password)', async () => {
    const seeded = await prisma.customer.create({ data: { email: EMAIL_LINK, name: 'Has Pw', passwordHash: 'hash' } });
    const linked = await resolveGoogleCustomer(prisma, { sub: SUB2, email: EMAIL_LINK, name: 'Has Pw' });
    expect(linked.id).toBe(seeded.id);
    expect(linked.googleId).toBe(SUB2);
    expect(linked.passwordHash).toBe('hash');
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/auth.google.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `backend/src/modules/auth/google.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { Customer, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { httpError } from '../../lib/errors';
import { signCustomerToken } from '../../lib/jwt';
import { customerDto } from './dto';
import { env } from '../../env';

const googleBody = z.object({ credential: z.string().min(1) });

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  emailVerified: boolean;
}

let oauthClient: OAuth2Client | null = null;
function getClient(): OAuth2Client {
  return (oauthClient ??= new OAuth2Client(env.GOOGLE_CLIENT_ID));
}

/** Verify a Google ID token (signature/audience/issuer/expiry) and extract the profile. */
export async function verifyGoogleIdToken(credential: string): Promise<GoogleProfile> {
  const ticket = await getClient().verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (!p || !p.sub || !p.email) throw httpError(401, 'Invalid Google token');
  return { sub: p.sub, email: p.email, name: p.name, emailVerified: p.email_verified === true };
}

/** Resolve the customer: find by googleId → link by email → create. */
export async function resolveGoogleCustomer(
  prisma: PrismaClient,
  profile: { sub: string; email: string; name?: string },
): Promise<Customer> {
  const email = profile.email.toLowerCase();
  const existing = await prisma.customer.findUnique({ where: { googleId: profile.sub } });
  if (existing) return existing;
  const byEmail = await prisma.customer.findUnique({ where: { email } });
  if (byEmail) {
    return prisma.customer.update({
      where: { id: byEmail.id },
      data: { googleId: profile.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() },
    });
  }
  return prisma.customer.create({
    data: {
      email,
      name: profile.name?.trim() || email.split('@')[0],
      googleId: profile.sub,
      emailVerifiedAt: new Date(),
    },
  });
}

export function registerGoogleRoute(
  app: FastifyInstance,
  verify: (credential: string) => Promise<GoogleProfile> = verifyGoogleIdToken,
) {
  app.post(
    '/api/auth/google',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { credential } = googleBody.parse(request.body);
      let profile: GoogleProfile;
      try {
        profile = await verify(credential);
      } catch {
        throw httpError(401, 'Google sign-in failed');
      }
      if (!profile.emailVerified) throw httpError(401, 'Your Google email is not verified');
      const customer = await resolveGoogleCustomer(app.prisma, profile);
      return { token: signCustomerToken(customer), customer: customerDto(customer) };
    },
  );
}
```

- [ ] **Step 5: Register the route in `backend/src/modules/auth/routes.ts`**

Add the import near the other `./` imports:
```ts
import { registerGoogleRoute } from './google';
```
And add this line just before the closing `}` of `authRoutes`:
```ts
  registerGoogleRoute(app);
```

- [ ] **Step 6: Run the test — verify it passes**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run tests/auth.google.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 7: Full-suite checkpoint + commit**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
git add backend/src/env.ts backend/src/modules/auth/google.ts backend/src/modules/auth/routes.ts backend/tests/auth.google.test.ts
git commit -m "feat(auth): backend Google ID-token login (verify + find/link/create)"
```
Expected: green (150 prior + google 3 = 153). (`google-auth-library` is already in package.json — do not re-add it.)

---

### Task 2: Frontend — BFF endpoint + Google button

**Files:**
- Create: `frontend/src/pages/api/auth/google.ts`
- Create: `frontend/src/components/auth/GoogleSignIn.astro`
- Modify: `frontend/src/pages/account/login.astro`
- Modify: `frontend/src/pages/account/register.astro`

**Interfaces:**
- Consumes: `SESSION_COOKIE` (`../../../lib/auth`); the backend `POST /api/auth/google` (Task 1); `PUBLIC_GOOGLE_CLIENT_ID`.
- Produces: a storefront BFF `POST /api/auth/google` that sets `rr_session`; a `<GoogleSignIn />` button.

- [ ] **Step 1: Create the BFF endpoint `frontend/src/pages/api/auth/google.ts`**

```ts
import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
const WEEK = 60 * 60 * 24 * 7;

export const POST: APIRoute = async ({ request, cookies }) => {
  const { credential, next } = await request.json().catch(() => ({ credential: '', next: '/account' }));
  // Local-path-only guard (same as login.ts) so `next` can't become an open redirect.
  const safeNext =
    typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && next.charCodeAt(1) !== 92
      ? next
      : '/account';
  const res = await fetch(`${API}/api/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Google sign-in failed' }));
    return new Response(JSON.stringify({ ok: false, message: err.message ?? 'Google sign-in failed' }), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  const data = await res.json();
  cookies.set(SESSION_COOKIE, data.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: import.meta.env.PROD,
    maxAge: WEEK,
  });
  return new Response(JSON.stringify({ ok: true, next: safeNext }), {
    headers: { 'content-type': 'application/json' },
  });
};
```

- [ ] **Step 2: Create the button `frontend/src/components/auth/GoogleSignIn.astro`**

```astro
---
const clientId = import.meta.env.PUBLIC_GOOGLE_CLIENT_ID;
---
{clientId && (
  <div class="flex flex-col gap-4 mt-2">
    <div class="flex items-center gap-4 text-label-caps uppercase opacity-40">
      <span class="hairline-t flex-1"></span><span>or</span><span class="hairline-t flex-1"></span>
    </div>
    <div id="g_signin" data-client-id={clientId} class="grid place-items-center min-h-[44px]"></div>
  </div>
)}

<script is:inline async src="https://accounts.google.com/gsi/client"></script>
<script>
  function rrInitGoogle(): void {
    const g = (window as any).google;
    const el = document.getElementById('g_signin');
    if (!el || !g?.accounts?.id) return;
    const clientId = el.getAttribute('data-client-id');
    const params = new URLSearchParams(location.search);
    const next = params.get('next') || '/account';
    g.accounts.id.initialize({
      client_id: clientId,
      callback: async (resp: { credential: string }) => {
        const r = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ credential: resp.credential, next }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.ok) window.location.assign(data.next || '/account');
        else window.location.assign('/account/login?error=' + encodeURIComponent(data.message || 'Google sign-in failed'));
      },
    });
    g.accounts.id.renderButton(el, { theme: 'outline', size: 'large', width: 320, text: 'continue_with' });
  }
  // GIS loads async — poll briefly until ready, then init.
  let tries = 0;
  const timer = setInterval(() => {
    if ((window as any).google?.accounts?.id) {
      clearInterval(timer);
      rrInitGoogle();
    } else if (++tries > 50) {
      clearInterval(timer);
    }
  }, 100);
</script>
```

- [ ] **Step 3: Add the button to `frontend/src/pages/account/login.astro`**

Add the import to the frontmatter (with the other imports):
```ts
import GoogleSignIn from '../../components/auth/GoogleSignIn.astro';
```
Add `<GoogleSignIn />` immediately AFTER the closing `</form>` tag (before the forgot/create-account link row). Read the file to place it correctly; do not alter the existing form.

- [ ] **Step 4: Add the button to `frontend/src/pages/account/register.astro`**

Add the same import to its frontmatter:
```ts
import GoogleSignIn from '../../components/auth/GoogleSignIn.astro';
```
Add `<GoogleSignIn />` immediately AFTER the closing `</form>` tag. Do not alter the existing form.

- [ ] **Step 5: Build + full frontend suite**

```
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
```
Expected: build "Complete!"; 51 passed (no regression — the button is additive markup). The backend dev server must be up for the catalog tests.

- [ ] **Step 6: Commit**

```
git add frontend/src/pages/api/auth/google.ts frontend/src/components/auth/GoogleSignIn.astro frontend/src/pages/account/login.astro frontend/src/pages/account/register.astro
git commit -m "feat(auth): Sign in with Google button + BFF endpoint on login/register"
```

---

### Task 3: Verification sweep + memory

**Files:**
- Modify: `C:\Users\PC\.claude\projects\D--Roots---Rings\memory\MEMORY.md` + new `roots-rings-phase9-google-login.md`

- [ ] **Step 1: Suites + build**

```
cd "D:/Roots & Rings/backend"; node node_modules/vitest/vitest.mjs run
cd "D:/Roots & Rings/frontend"; node node_modules/vitest/vitest.mjs run
cd "D:/Roots & Rings/frontend"; node node_modules/astro/astro.js build
```
Expected: backend 153; frontend 51; build OK.

- [ ] **Step 2: Live curl/endpoint verification (controller-run)** — with the backend (`:4000`, `GOOGLE_CLIENT_ID` set) and the SSR frontend (`PORT=4321 node dist/server/entry.mjs`, built with `PUBLIC_GOOGLE_CLIENT_ID`) running:
  1. The button renders: `curl -s http://127.0.0.1:4321/account/login` contains `id="g_signin"` + the `data-client-id` with the real Client ID, and the GIS script src.
  2. The backend rejects a bad token: `curl -s -X POST http://127.0.0.1:4000/api/auth/google -H "content-type: application/json" -d '{"credential":"not-a-real-token"}'` → HTTP 401 with a "Google sign-in failed" message (proves verify runs + rejects).
  3. The BFF forwards: `curl -s -X POST http://127.0.0.1:4321/api/auth/google -H "content-type: application/json" -d '{"credential":"not-a-real-token"}'` → `{ ok:false, … }` with a 401 status (proves the BFF wiring).
  4. A real "click Sign in with Google" is a browser step (the controller attempts it if the browser tooling is available; otherwise it's a one-line manual check for the user — the verify + resolve + session path is exercised by the tests + the above).

- [ ] **Step 3: Update memory** — create `roots-rings-phase9-google-login.md` (Google login BUILT: GIS ID-token flow; `verifyGoogleIdToken` + `resolveGoogleCustomer` find/link/create + `POST /api/auth/google`; BFF sets rr_session; button on login/register; Client ID in both .env; google-auth-library; no migration) + a one-line pointer in `MEMORY.md`.

- [ ] **Step 4: Report** the final counts + the curl-verification results.

---

## Self-Review

**1. Spec coverage** (spec §2–§7 → tasks):
- §3 backend (verifyGoogleIdToken, resolveGoogleCustomer find/link/create, registerGoogleRoute + email_verified guard) → Task 1. ✅
- §4 frontend (BFF endpoint sets rr_session; GoogleSignIn component; login/register placement) → Task 2. ✅
- §5 env/deps (GOOGLE_CLIENT_ID in env.ts + .env; PUBLIC_GOOGLE_CLIENT_ID; google-auth-library) → Task 1 (env.ts) + Global Constraints (the .env values, controller-set). ✅
- §6 security (server-side verify; email_verified required; null-password login already 401; rate-limited) → Task 1. ✅
- §7 testing (resolveGoogleCustomer create/link/login; regression; curl verification) → Tasks 1, 3. ✅
- §8 file structure → matches Tasks 1–2. ✅

**2. Placeholder scan:** every code step contains complete code; the backend test step has real assertions; the frontend verification is explicit (`astro build` + suite + curl). No TBD/TODO.

**3. Type consistency:** `GoogleProfile {sub,email,name?,emailVerified}` (Task 1) is the return of `verifyGoogleIdToken` and the input shape (minus emailVerified) to `resolveGoogleCustomer`, used identically in `registerGoogleRoute`. The route returns `{token, customer}` (matching login/register), which the BFF (Task 2) reads as `data.token`. `SESSION_COOKIE` + the `next` guard mirror `login.ts`. The component POSTs `{credential, next}` which the BFF reads. `PUBLIC_GOOGLE_CLIENT_ID` (component) + `GOOGLE_CLIENT_ID` (env.ts/route) are the two env names used consistently. The test calls `resolveGoogleCustomer(prisma, {sub,email,name})` — matching its signature. ✅
