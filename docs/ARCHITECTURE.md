# MyCity architecture

## 1. Stack and why

| Layer | Choice | Why |
| --- | --- | --- |
| Language | **TypeScript everywhere** | One language for API, website and mobile app. One team can work on all three, and data shapes stay consistent. |
| API | **Node.js 22 + Fastify** | Among the fastest Node web frameworks; low memory per request, so cheap to scale horizontally. Stateless, so you can run 2 or 200 copies behind a load balancer. |
| Database | **PostgreSQL 16** | Handles hundreds of millions of rows with proper indexes; real transactions and row locks for the wallet; JSONB for category-specific lead fields; table partitioning for big tables; PostGIS for map/radius search when needed. |
| Web | **Next.js (React)** | Fast, SEO-friendly pages for city/category landing pages; same React skills as mobile; installable as a PWA. |
| Mobile | **Expo / React Native** | One codebase for Android and iOS; over-the-air updates; push notifications via Expo/FCM. |
| Cache / queues (next) | **Redis + BullMQ** | Background jobs for lead distribution, notifications, AI calls; rate limiting; chat fan-out. |
| Search (later) | **OpenSearch** | When directory search outgrows PostgreSQL full-text. |
| Files | **S3-compatible storage** | Lead photos, vendor documents, quote attachments. |
| Payments | **Razorpay** | Wallet recharge via checkout + verified webhook. |

**Difference from the blueprint.** The blueprint suggested Laravel (PHP) + MySQL. Both would work. I chose TypeScript + PostgreSQL because you asked for one language that handles large data and serves both app and web: with TypeScript the same developers build the API, website and mobile app, and PostgreSQL gives stronger tools for the hard parts of MyCity (atomic wallet charges, location radius matching, flexible per-category fields, partitioning when data grows). The module boundaries and database design from the blueprint are kept as they were.

## 2. System overview

```
 Customers / Vendors / Admin
   │ Android & iOS (Expo)     │ Web + PWA (Next.js)
   └────────────┬─────────────┘
                ▼
        Load balancer (HTTPS)
                ▼
     API servers (Fastify, stateless, N copies)
      │            │              │
      ▼            ▼              ▼
  PostgreSQL     Redis        S3 storage
  (primary +   (cache, queues,
   read replicas) chat pub/sub)
                   │
                   ▼
           Workers (BullMQ): lead distribution, SMS/push/WhatsApp,
           AI classification, lead expiry, statements
```

The API is a **modular monolith**: one deployable, separate modules (auth, catalog, leads, matching, quotations, wallet, chat, admin). Split a module into its own service only when its load demands it.

## 3. Core flow

1. Customer describes the need. `POST /ai/classify` suggests the category.
2. `POST /leads` stores the lead and runs **matching**: approved vendors serving that category (or its parent), whose service radius covers the lead's location, below their active-lead cap, ranked by distance then rating, limited to `max_vendors_per_lead`. A vendor in Kaushambi with a 60 km radius gets Prayagraj leads; that is how nearby cities are served.
3. Vendors see a **masked** lead (no name, phone, email or address) and the fee for that category before quoting.
4. `POST /vendor/leads/:id/quote` runs in **one database transaction**: lock assignment, check lead is open, resolve fee, lock wallet, check balance, insert quotation, debit wallet, append ledger row. Any failure rolls everything back. `UNIQUE(lead_id, vendor_id)` makes a double charge impossible, even with simultaneous taps.
5. Revisions (`PUT /vendor/quotes/:id`) are free.
6. Customer and vendors chat in-app. Phone numbers, emails, links and "WhatsApp" are replaced with "[hidden by MyCity]" before selection.
7. Customer selects a quote. Only that vendor's API response now includes the customer contact (Phase 1). Switching the admin setting `contact_reveal_mode` to `never` turns on Phase 2 (MyCity-only communication) with no code change.

## 4. Data model (PostgreSQL)

Money is stored in **paise** as integers. Key tables (see `apps/api/migrations/001_init.sql`):

- `cities`, `localities` with lat/lng: city-wise operation and radius matching
- `users` (role customer/vendor/admin, phone): contact data lives here and is never joined into vendor-facing queries unless allowed
- `categories` (self-referencing for subcategories, `keywords`, JSONB `fields` for dynamic forms)
- `pricing_rules`: fee per category/subcategory, optional per city, with effective dates. The most specific rule wins. Old quotations keep the fee they paid.
- `vendors`, `vendor_categories`: profile, status (pending/approved/suspended), base location, service radius
- `leads`, `lead_vendors` (who got which lead, distance), `quotations`, `lead_selections`: kept separate as the blueprint recommends
- `wallets` (cached balance, `CHECK >= 0`) + `wallet_transactions` (append-only ledger with unique `reference` for idempotency)
- `conversations`, `messages` (with `redacted` flag)
- `admin_settings`, `audit_logs`

## 5. Handling large data

What is already in place:

- Every list query is backed by an index that matches its filter and sort (`leads(customer_id, created_at)`, `lead_vendors(vendor_id, notified_at)`, `messages(conversation_id, id)`, ...). Lists are capped and chat uses cursor (`after=id`) pagination, not OFFSET.
- Matching uses a bounding-box prefilter on indexed lat/lng before exact distance, so it does not scan all vendors.
- The API holds no state, so it scales by adding servers.

What to switch on as volume grows (no redesign needed):

| When | Do this |
| --- | --- |
| > 50k vendors | Add PostGIS, store `geography(Point)` with a GiST index, use `ST_DWithin` for matching |
| > 10M leads/messages | Partition `leads`, `lead_vendors`, `messages`, `wallet_transactions` by month (`created_at`) |
| Many cities | Use `city_id` as the routing key; heavy cities can get their own read replica |
| Read-heavy dashboards | Read replicas + PgBouncer; materialized views for admin reports |
| Matching/notifications slow down requests | Move `distributeLead` and notifications to BullMQ workers (already isolated in `lib/matching.ts`) |
| Live chat | WebSockets with Redis pub/sub instead of polling; storage stays the same |
| Directory search | OpenSearch, fed from PostgreSQL |

## 6. Security and privacy

- Role checks on every route on the server (`requireRole`), never only in the UI.
- Vendor endpoints select explicit columns; contact data comes only from the selection-gated query. Tests assert phone and address never appear in a vendor response before selection.
- OTP codes are stored hashed, expire in 10 minutes, and lock after 5 wrong tries.
- Every pricing change, refund, vendor status change and settings change is written to `audit_logs`.

## 7. Photos

- Customers attach up to 6 photos to a requirement, vendors up to 6 to a quotation and 12 to their business profile.
- Flow: the app uploads to `POST /uploads?kind=lead|quotation|vendor` first, gets photo ids back, then sends `photoIds` when saving the lead, quotation or profile. Only the uploader's own, not-yet-used photos can be attached.
- Every image is decoded and re-encoded (sharp): auto-rotated, max 1600 px, JPEG. Anything that is not a real image is rejected, and re-encoding strips EXIF metadata, so the GPS location a phone embeds in a photo never reaches vendors.
- Storage driver: `local` disk in development, any S3-compatible private bucket in production (`STORAGE_DRIVER=s3`). Keys are `kind/yyyy/mm/uuid.jpg`.
- Access: photos are never public. The API hands out a link only after checking the viewer may see the lead or quotation (same rules as the data itself); links expire after 1 hour (HMAC-signed for local, presigned for S3).
- Uploads never attached to anything are deleted after 24 hours by `sweepUnlinked` (to be scheduled in the worker).

## 8. AI

`lib/classify.ts` is the seam. Today it scores admin-managed keywords. Next step: send the text to an LLM, ask it to pick from the category list and extract the category's fields, then **validate the answer against the database** before use. Money, privacy and matching eligibility stay deterministic code.

## 9. Roadmap from here

1. **Payments**: Razorpay order + signed webhook credits the wallet (`reference = pay:<payment_id>` is already idempotent). Turn off dev recharge with `PAYMENTS_DEV_MODE=false`.
2. **OTP SMS**: MSG91/Twilio; set `OTP_DEV_MODE=false`; add rate limiting per phone and IP.
3. **Uploads**: photos are done; next are vendor verification documents (PDF) and a scheduled sweeper job.
4. **Notifications**: push (Expo/FCM) for new lead, new quote, new message, selection; low-wallet alert.
5. **Queues**: BullMQ workers for matching, notifications, lead expiry and "no response" reassignment.
6. **LLM assistant**: conversational requirement capture, quote comparison summary, Hindi support.
7. **Reviews and ratings** after completion; vendor performance stats feed ranking.
8. **Phase 2**: switch `contact_reveal_mode` to `never`, add in-app calling.
9. **Modules**: bulk buying, jobs, student rooms, study material (reuse accounts, cities and chat).
