# Roots & Rings — Phase 9 Design Spec (Google login)

**Date:** 2026-07-01
**Status:** Approved
**Builds on:** Phases 1–8. Customer accounts (Phase 3) already issue a JWT (`signCustomerToken`) and the
storefront BFF sets an httpOnly `rr_session` cookie. The `Customer.googleId String? @unique` field
already exists (scaffolded in Phase 3). This phase adds "Sign in with Google".

## 0. Decisions (confirmed)

- **Google Identity Services ID-token flow** (not the redirect/auth-code flow): the GIS button returns a
  signed ID token; the backend verifies it and issues the SAME customer JWT/session as password login.
  Only the public **Client ID** is needed (no Client Secret).
- **Auto-link by verified email:** a Google sign-in whose verified email matches an existing password
  account links to it (sets `googleId`) and logs in. Safe because Google has verified the email.
- Client ID: `146901308187-merhd0hu1tlbudoc8ocse6dm86349aob.apps.googleusercontent.com` (public; consent
  screen is published).

## 1. Goals & non-goals

**Goals**
- A "Sign in with Google" button on the login + register pages that logs the customer in via the
  existing session, creating or linking the account as needed.
- Server-side ID-token verification (signature, audience, `email_verified`).
- Reuse the existing JWT + `rr_session` cookie + `customerDto` — no new session machinery.

**Non-goals (later)**
- One Tap auto-prompt, Google profile-photo import, an account-settings "unlink Google", additional
  providers, the redirect/auth-code flow.

## 2. Architecture

- **Frontend:** a `GoogleSignIn.astro` component loads Google's GIS script (`accounts.google.com/gsi/client`),
  renders the button with `PUBLIC_GOOGLE_CLIENT_ID`, and on its credential callback POSTs
  `{ credential, next }` to a new storefront BFF endpoint `/api/auth/google`. Used on `login.astro` +
  `register.astro`.
- **BFF (`frontend/src/pages/api/auth/google.ts`):** forwards the credential to the backend, gets
  `{ token }`, sets the `rr_session` cookie (same options as `login.ts`), returns `{ ok, next }` (JSON);
  the component redirects client-side.
- **Backend (`modules/auth/google.ts`):** `verifyGoogleIdToken` (google-auth-library) +
  `resolveGoogleCustomer` (find/link/create) + `registerGoogleRoute(app)` (`POST /api/auth/google`).
  Registered from `authRoutes`.

## 3. Backend (`modules/auth/google.ts`)

- `verifyGoogleIdToken(credential): Promise<{ sub, email, name?, emailVerified }>` — uses
  `new OAuth2Client(env.GOOGLE_CLIENT_ID).verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID })`,
  which checks the signature against Google's public keys, the audience, the issuer, and expiry. Returns
  the payload's `sub`/`email`/`name`/`email_verified`; throws on an invalid token.
- `resolveGoogleCustomer(prisma, { sub, email, name }): Promise<Customer>` — the account resolution:
  1. find by `googleId === sub` → return it;
  2. else find by `email` → **link** (set `googleId`, set `emailVerifiedAt` if unset) → return it;
  3. else **create** (`email`, `name` (or the email local-part), `googleId`, `emailVerifiedAt = now`, no
     `passwordHash`).
- `registerGoogleRoute(app, verify = verifyGoogleIdToken)` — `POST /api/auth/google` (rate-limited like
  the other auth routes): parse `{ credential }`; `const p = await verify(credential)` (401 on failure);
  **reject if `!p.emailVerified`** (401 — never link/create from an unverified Google email); then
  `resolveGoogleCustomer(prisma, p)`; return `{ token: signCustomerToken(customer), customer: customerDto(customer) }`.
  The `verify` parameter is a DI seam (tests can pass a fake; production uses the real verifier).

## 4. Frontend

- **`components/auth/GoogleSignIn.astro`** — renders a container div + loads the GIS script + initializes
  `google.accounts.id` with `client_id = import.meta.env.PUBLIC_GOOGLE_CLIENT_ID` and a callback that
  `fetch`es `POST /api/auth/google` with `{ credential, next }` (same-origin; the BFF's `Set-Cookie` is
  honored), then `window.location = data.next || '/account'` on success. Reads `next` from the page URL.
  If `PUBLIC_GOOGLE_CLIENT_ID` is unset, the component renders nothing (no broken button).
- **`pages/api/auth/google.ts`** (BFF) — `POST`: read `{ credential, next }`; forward to backend
  `/api/auth/google`; on `200`, set `rr_session` (httpOnly, sameSite lax, path /, secure in prod, 1-week)
  and return `{ ok: true, next: safeNext }` (reuse the `login.ts` local-path-only `next` guard); on
  failure return the error JSON with the upstream status.
- **`login.astro` + `register.astro`:** add an "or" divider + `<GoogleSignIn />` below the existing form.
  No change to the existing form/markup.

## 5. Env & deps

- `backend/.env`: `GOOGLE_CLIENT_ID=146901308187-…apps.googleusercontent.com` (gitignored).
- `frontend/.env`: `PUBLIC_GOOGLE_CLIENT_ID=146901308187-…apps.googleusercontent.com` (public — baked into
  the build; safe to expose).
- `backend/src/env.ts`: add `GOOGLE_CLIENT_ID: z.string().optional()`.
- Backend dep: **`google-auth-library`** (already installed). No migration (`googleId` exists).

## 6. Security & correctness

- The ID token is verified **server-side** (google-auth-library checks signature/audience/issuer/expiry);
  the client never sends raw profile data we trust — only the signed token.
- `email_verified` is required → we never link to or create from an email the Google user hasn't proven
  they own (prevents account-takeover by an unverified email).
- Auto-linking is by the verified email only; the Client Secret is never used (ID-token flow).
- Google-only accounts have `passwordHash = null`; the existing password-login route must treat a null
  hash as "invalid credentials" (verify in the plan). Such users can add a password later via the
  existing forgot-password → reset flow.
- The Google route is rate-limited like the other auth routes. The BFF sets the same httpOnly session
  cookie as password login; the Client ID is public and safe client-side.

## 7. Testing

- **Backend (Vitest + test DB):** `resolveGoogleCustomer` — (a) creates a new customer with `googleId` +
  `emailVerifiedAt` set and `passwordHash` null; (b) links an existing password account by email (sets
  `googleId`, keeps the password); (c) logs in an existing `googleId` account (returns the same row, no
  duplicate). 3 tests.
- **Regression:** the existing auth suite stays green; a Google-only account (null password) attempting
  password login returns 401, not a crash.
- Existing **150 backend + 51 frontend** stay green; the storefront build passes.
- **Verification:** the real "click Google" is a browser step; the BFF/endpoint wiring + the rendered
  button (with the Client ID) are checked via curl + build. The ID-token signature path can't be unit
  tested without a live Google token, so the email_verified guard + verify wiring are covered by the
  final review.

## 8. File structure

**Backend (new):** `modules/auth/google.ts`, `tests/auth.google.test.ts`.
**Backend (modified):** `modules/auth/routes.ts` (register the route), `src/env.ts` (`GOOGLE_CLIENT_ID`).
**Frontend (new):** `components/auth/GoogleSignIn.astro`, `pages/api/auth/google.ts`.
**Frontend (modified):** `pages/account/login.astro`, `pages/account/register.astro` (add the button).
**Env:** `backend/.env` (`GOOGLE_CLIENT_ID`), `frontend/.env` (`PUBLIC_GOOGLE_CLIENT_ID`).

## 9. Rollout

No migration. With the Client ID in both `.env`s, the button appears and works immediately; without it,
the component renders nothing (graceful). After Phase 9: bKash live, i18n/multi-currency, infra
enhancements.
