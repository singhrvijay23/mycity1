# MyCity

City-wise lead sharing marketplace. Customers post a requirement once, matching vendors in the city (and nearby cities, by service radius) pay a small admin-set fee per quotation, customers compare quotes and chat inside MyCity, and the customer's contact is shared only with the vendor they select.

| App | Path | Stack |
| --- | --- | --- |
| API | `apps/api` | Node.js 22, TypeScript, Fastify, PostgreSQL 16 |
| Web (customer, vendor, admin) | `apps/web` | Next.js 16 (React), installable as a PWA |
| Mobile (Android / iOS) | `apps/mobile` | Expo / React Native |

Architecture, data model and scaling plan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it locally

Requirements: Node 22+, Docker (or a local PostgreSQL 16).

```bash
docker compose up -d                 # PostgreSQL + Redis
npm install                          # installs api + web
cp apps/api/.env.example apps/api/.env
npm run seed                         # creates tables + demo data (Prayagraj and nearby cities, 30+ categories)
npm run dev:api                      # http://localhost:4000
npm run dev:web                      # http://localhost:3000
```

Mobile app (separate install because Expo pins its own React Native versions):

```bash
cd apps/mobile && npm install
# point the app at your API: edit "extra.apiUrl" in app.json
#   Android emulator: http://10.0.2.2:4000   real phone: http://<your-computer-LAN-IP>:4000
npx expo start                        # scan the QR code with Expo Go
```

For photos to load on a phone, also set `PUBLIC_API_URL` in `apps/api/.env` to the same address the phone uses (photo links are built from it).

### Demo logins (OTP is always `123456` in development)

| Role | Mobile |
| --- | --- |
| Customer | 9000000001 |
| Vendor, plumber, Prayagraj | 9100000001 |
| Vendor, electrician, Prayagraj | 9100000002 |
| Vendor, AC + electrical, Prayagraj | 9100000003 |
| Vendor, plumber, Kaushambi (60 km radius, gets Prayagraj leads) | 9100000004 |
| Admin | 9999999999 |

Each demo vendor starts with ₹500 welcome credit.

## Tests

```bash
npm test     # API integration tests against a real PostgreSQL database (mycity_test)
```

They cover matching (including the nearby-city vendor), contact privacy before and after selection, one-time atomic fee charging under concurrent submits, free revisions, insufficient balance, chat redaction, Phase 2 "never share" mode, pricing changes, refunds and vendor approval.

## What is built (V1.0 scaffold)

- OTP login for customers, vendors and admins (dev OTP; plug in an SMS provider for production)
- Dynamic categories and subcategories with per-category form fields, managed by admin
- Natural-language search that maps text to a category (keyword classifier, ready to swap for an LLM)
- Lead posting with city, locality, budget, date and a private address
- Automatic matching: category + service radius (covers nearby cities) + approval + capacity, ranked by distance and rating
- Masked lead view for vendors; contact revealed only to the selected vendor, enforced in the API
- Quotation with price breakup; fee shown before submit and charged once, atomically, from a prepaid wallet; revisions free
- Wallet with an append-only ledger, recharge (dev) and admin refunds
- Photos on requirements, quotations and vendor profiles: camera or gallery on mobile, resized to 1600 px, location data (EXIF/GPS) stripped, private links that expire after an hour
- In-app chat that hides phone numbers, emails and links until selection (always, in Phase 2 mode)
- Admin: dashboard, revenue by category, vendor approval, leads, category-wise pricing, settings including the Phase 1 / Phase 2 contact switch

## Next steps

See "Roadmap" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): Razorpay webhook, SMS OTP, push notifications, queue workers, LLM requirement assistant, reviews.
