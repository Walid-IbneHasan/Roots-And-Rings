# Roots & Rings Backend — Phase 3 Design Spec (Customer accounts + order history)

**Date:** 2026-06-29
**Status:** Approved
**Builds on:** Phase 1 (catalog API + admin) and Phase 2 (checkout core). This phase adds customer
accounts on top of the existing guest checkout — guest checkout stays fully functional.

## 0. Decisions (confirmed)

- **Email + password and OTP flows** — registration/login with bcrypt + JWT; email verification,
  password reset, and OTP-guarded password change via one-time codes. Google OAuth is deferred.
- **OTP emails are logged no-ops** until SMTP lands (Phase 4). In dev, the verify/reset code is
  read from the backend server log (same `Job`/notifications mechanism Phase 2 introduced).
- **Saved addresses** — an address book (shipping/billing, default flag, Bangladesh fields),
  managed in the account area and used to pre-fill checkout for logged-in customers.
- **Orders attach when logged in only** — an order placed while authenticated is tagged with
  `customerId`; past guest orders are NOT auto-claimed by email (email isn't verifiable for guests,
  so claiming would risk exposure). Claiming can be added once email verification is mature.

## 1. Goals & non-goals

**Goals**
- Customer auth: register, login, logout, `me`; JWT signed by the backend.
- OTP system: email verification, password reset (logged-out), OTP-guarded password change.
- Account self-service API: dashboard, owner-scoped order history + detail, profile, avatar,
  address CRUD with default selection.
- Checkout integration: attach `customerId` when authenticated; pre-fill from the default address.
- Storefront account area (on-brand, no redesign) with a thin **BFF** that owns the session cookie.
- Tests: unit (JWT, OTP, password hashing) + integration (auth, owner-scoping 404, address CRUD,
  password reset via OTP, checkout attribution); a browser pass.

**Non-goals (Phase 4+)**
- Google OAuth / social login. Real SMTP delivery (emails stay logged no-ops).
- Claiming guest orders by email; backend-persisted cart / guest-cart merge.
- Coupons, reviews, wishlist sync, loyalty, SEO/CMS, the enhancements list.

## 2. Architecture — Backend-for-Frontend (BFF)

The storefront (`:4321`) and API (`:4000`) are different origins. Rather than fight cross-site
cookies, the **storefront owns the session**:

- The browser only ever talks to the storefront's own same-origin `/api/*` endpoints (Astro
  server endpoints). These act as a thin BFF.
- On login/register, the BFF calls the backend, receives a signed **JWT**, and stores it in an
  **httpOnly cookie** (`rr_session`) on the storefront domain (`SameSite=Lax`, `Secure` in prod,
  `path=/`, ~7-day maxAge). Logout deletes the cookie.
- Authenticated **data** flows: storefront SSR pages / BFF endpoints read the cookie and call the
  backend with `Authorization: Bearer <jwt>`. The backend independently verifies the JWT and loads
  the customer (the authoritative gate).
- The storefront also verifies the JWT locally (shared `JWT_SECRET`, server-side only, never
  shipped to the browser) to gate `/account/*` SSR rendering and show header state — avoiding an
  extra backend round-trip for auth state. The backend remains the source of truth for data.

Catalog pages stay SSR exactly as today; nothing about the public catalog changes.

## 3. Schema additions (Prisma)

Enums: `OtpType { EMAIL_VERIFY PASSWORD_RESET PASSWORD_CHANGE }`,
`AddressType { SHIPPING BILLING }`.

- **Customer**: id, email(@unique, lowercased), passwordHash?(String — nullable for future OAuth),
  name, phone?, imageUrl?, googleId?(@unique — reserved, unused this phase), emailVerifiedAt?,
  isActive(Boolean @default true), createdAt, updatedAt. Relations: `otps`, `addresses`.
  (Orders relate by the existing `Order.customerId` String column — kept FK-less to preserve the
  Phase 2 guest-order shape; account queries filter `where customerId = me.id`.)
- **CustomerOtp**: id, customerId(→Customer, cascade), type(OtpType), codeHash(String — bcrypt hash
  of a 6-digit code), expiresAt, attempts(Int @default 0), consumedAt?, createdAt.
  Index (customerId, type), (expiresAt).
- **Address**: id, customerId(→Customer, cascade), type(AddressType @default SHIPPING),
  isDefault(Boolean @default false), name, phone, line1, line2?, city, district, postalCode?,
  country(String @default "Bangladesh"), createdAt, updatedAt. Index (customerId).

Migration is additive only (no changes to Phase 1/2 tables). `Order.customerId` already exists.

## 4. Auth & JWT (backend `modules/auth/`)

- **JWT**: `lib/jwt.ts` — `signCustomerToken(customer)` → HS256 token `{ sub: id, email, name }`,
  expiry from `JWT_EXPIRES_IN` (default `7d`); `verifyCustomerToken(token)` → payload | throws.
  New env `JWT_SECRET` (≥32 chars, zod-validated). Library: `jsonwebtoken`.
- **Password**: `lib/password.ts` — `hashPassword`, `verifyPassword` (bcryptjs, already a dep).
- **Guards** (`modules/auth/guards.ts`): `customerContext` (decode bearer, attach
  `req.customer` claim, no DB hit, never throws) and `requireCustomer` (verify + load Customer +
  assert `isActive`, else 401). Registered as Fastify preHandlers/decorators.
- **Routes** (`modules/auth/routes.ts`), all zod-validated, rate-limited (tighter on
  login/forgot — reuse the Phase 1 admin-login limiter pattern):
  - `POST /api/auth/register` { name, email, password } → create customer (email lowercased,
    bcrypt), issue an `EMAIL_VERIFY` OTP (enqueued/logged), return `{ token, customer }`.
    409 on duplicate email.
  - `POST /api/auth/login` { email, password } → verify; 401 on bad creds or inactive;
    return `{ token, customer }`.
  - `GET /api/auth/me` (requireCustomer) → `{ customer }`.
  - `POST /api/auth/verify-email` { code } (requireCustomer) → consume `EMAIL_VERIFY` OTP, set
    `emailVerifiedAt`.
  - `POST /api/auth/forgot-password` { email } → if the email exists, issue a `PASSWORD_RESET` OTP
    (logged); **always returns 200** (no account enumeration).
  - `POST /api/auth/reset-password` { email, code, newPassword } → verify OTP, set new hash.
  - `logout` is storefront-only (cookie delete); the JWT is stateless. (No server route needed.)

Customer DTO returned to the storefront: `{ id, name, email, phone, imageUrl, emailVerifiedAt }`
— never the hash.

## 5. OTP system (`modules/auth/otp.ts`)

- `issueOtp(db, customerId, type)`: generate a 6-digit numeric code, hash it with bcrypt (codes are
  short-lived + attempt-capped), set `expiresAt = now + OTP_TTL_MIN` (default 15), invalidate prior
  unconsumed codes of
  the same type, persist, and hand the **plaintext** code to the notifications layer to "send"
  (logged no-op via the Phase 2 `Job` mechanism). Returns the plaintext only to the caller (tests
  use it; routes pass it to the mailer, never to the HTTP response).
- `verifyOtp(db, customerId, type, code)`: load newest unconsumed non-expired code; increment
  `attempts`; reject after `OTP_MAX_ATTEMPTS` (default 5) or on mismatch/expiry; on success set
  `consumedAt`. Throws `OtpError(statusCode=400)` on failure.
- Password change (logged-in) is OTP-guarded: `POST /api/account/password/request-code`
  (requireCustomer → issue `PASSWORD_CHANGE` OTP) then `POST /api/account/password/change`
  { code, currentPassword, newPassword } → verify current password **and** OTP, then rotate.

## 6. Account API (`modules/account/`, all `requireCustomer`)

- `GET /api/account` → `{ customer, recentOrders }` (5 most recent owned orders, summarized).
- `GET /api/account/orders` → owned orders (newest first), summarized.
- `GET /api/account/orders/:orderNumber` → full owned order detail; **404 if not owned** (filter
  by `customerId = me.id`, never by token). Reuses the Phase 2 order DTO shape.
- `PATCH /api/account/profile` { name?, phone? } → update + return customer.
- `POST /api/account/avatar` (multipart) → reuse the Phase 1 WebP pipeline (magic-byte validation,
  EXIF-rotate, ≤512px for avatars, q80, random name) → set `imageUrl`.
- `GET/POST/PATCH/DELETE /api/account/addresses[/:id]` + `POST /api/account/addresses/:id/default`
  — owner-scoped CRUD; setting a default clears the previous default in a transaction.
- Password change endpoints from §5.

## 7. Checkout integration

- `POST /api/checkout` gains an **optional** `customerContext` preHandler: if a valid bearer is
  present, set `order.customerId = me.id` and use the account email as `guestEmail` when the body
  omits contact email. No bearer → unchanged guest flow.
- The storefront checkout page, when the SSR session is present, **pre-fills** contact + shipping
  from the customer's profile + default address, and the BFF `/api/checkout` proxy forwards the
  bearer so the order is attributed. Guests are entirely unaffected.

## 8. Storefront (on-brand, no redesign)

**BFF endpoints** (`frontend/src/pages/api/`, Astro server endpoints):
`auth/login`, `auth/register`, `auth/logout`, `auth/forgot`, `auth/reset`, `auth/verify`,
`checkout` (proxy + attach bearer), and `account/[...path]` (generic authed proxy for profile,
avatar, addresses). Each reads/sets the `rr_session` httpOnly cookie and forwards to the backend.

**Session lib** (`frontend/src/lib/auth.ts`): `getSession(Astro)` (read+verify cookie → payload |
null), `requireSession(Astro)` (redirect to `/account/login?next=` when absent), `bearer(Astro)`
(raw token for proxying). Adds `jsonwebtoken` + `JWT_SECRET` to the frontend (server-side only).

**Pages** (reuse tokens, `.input-minimal`, `.btn-solid`, `BaseLayout`, fade-up — no new visual
language): `/account/login`, `/account/register`, `/account` (dashboard: greeting + recent orders +
links), `/account/orders`, `/account/orders/[orderNumber]`, `/account/profile` (profile + avatar +
change-password), `/account/addresses` (list + add/edit/delete/default), `/account/forgot-password`,
`/account/reset-password`, `/account/verify-email`. Account-area pages share a small left-nav
partial. SSR-gated via `requireSession`.

**Header**: the existing Account icon repoints from `/about` to `/account` (link target only — no
visual change). When a session exists, `/account` shows the dashboard; otherwise it redirects to
login.

## 9. Security

- bcrypt password hashing; JWT HS256 with a ≥32-char secret; httpOnly + SameSite=Lax session
  cookie (Secure in prod). OTP codes hashed at rest, short TTL, attempt-capped, single-use,
  prior-code invalidation. `forgot-password` is enumeration-safe (always 200).
- Strict **owner-scoping**: every account/order query filters by `customerId = me.id`; a
  non-owned `orderNumber` returns 404, never another customer's data.
- Rate-limit auth endpoints (login/register/forgot tighter). Reuse Phase 1 Helmet/CORS/CSRF posture
  (CORS already allows the storefront origin; BFF proxying keeps credentials server-side).
- Avatar upload uses the existing hardened pipeline (magic-byte sniff, re-encode, random names).

## 10. Testing

- **Unit**: `jwt` (sign/verify/expiry/tamper), `password` (hash/verify), `otp` (issue/verify,
  expiry, attempt cap, single-use, prior-invalidation).
- **Integration (Fastify `.inject()`)**: register→login→me happy path + duplicate-email 409 +
  bad-creds 401; email-verify via issued code; forgot→reset password via issued code;
  account orders owner-scoping (owner sees it, other customer gets 404); address CRUD + default
  switching; checkout with a bearer attaches `customerId`; checkout without a bearer stays guest.
- **Frontend**: a small `auth.ts` unit test (verify/expire). Existing 41 frontend + 84 backend
  tests must stay green.
- **Browser pass**: register → verify (code from log) → place a COD order while logged in →
  see it under `/account/orders` → order detail renders; profile + address edits persist.

## 11. File structure

**Backend** (new): `modules/auth/{routes,guards,otp}.ts`, `modules/account/{routes,addresses}.ts`,
`lib/{jwt,password}.ts`, `modules/notifications/` gains an `otp` email job (logged). `env.ts` +
`JWT_SECRET`/`JWT_EXPIRES_IN`/`OTP_TTL_MIN`/`OTP_MAX_ATTEMPTS`. `app.ts` registers auth + account
routes and the optional `customerContext` on checkout. `prisma/schema.prisma` + migration + a seed
demo customer (`customer@rootsandrings.example` / `ChangeMe123!`, email pre-verified).

**Frontend** (new): `src/lib/auth.ts`, `src/pages/api/auth/*.ts`, `src/pages/api/checkout.ts`,
`src/pages/api/account/[...path].ts`, `src/pages/account/*.astro`, a `src/components/account/`
nav partial. `checkout.ts` repointed to the same-origin BFF `/api/checkout`. Header Account link
updated. `.env` + `JWT_SECRET` (shared with backend).

## 12. Rollout

Additive migration; guest checkout and the public catalog are untouched. bKash/SMTP remain
deferred. After Phase 3: coupons & reviews (Phase 4), then retention/SEO/enhancements.
