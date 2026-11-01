-- MyCity core schema. All money is stored in paise (integer) to avoid floating point errors.
-- Large, fast-growing tables (leads, lead_vendors, messages, wallet_transactions) are keyed so they
-- can later be range-partitioned by created_at or list-partitioned by city_id without app changes.

CREATE TABLE cities (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  state       text NOT NULL,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (name, state)
);

CREATE TABLE localities (
  id       serial PRIMARY KEY,
  city_id  int NOT NULL REFERENCES cities(id),
  name     text NOT NULL,
  lat      double precision NOT NULL,
  lng      double precision NOT NULL,
  UNIQUE (city_id, name)
);

CREATE TYPE user_role AS ENUM ('customer', 'vendor', 'admin');
CREATE TYPE account_status AS ENUM ('active', 'blocked');

CREATE TABLE users (
  id          bigserial PRIMARY KEY,
  role        user_role NOT NULL,
  name        text NOT NULL,
  -- Contact details. Never selected by vendor-facing queries unless the privacy policy allows it.
  phone       text NOT NULL,
  email       text,
  city_id     int REFERENCES cities(id),
  status      account_status NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone, role)
);

CREATE TABLE otp_codes (
  phone       text PRIMARY KEY,
  code_hash   text NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL
);

CREATE TYPE category_type AS ENUM ('service', 'product', 'professional', 'manufacturer', 'dealer');

-- Categories and subcategories share one table (parent_id null = top level).
CREATE TABLE categories (
  id          serial PRIMARY KEY,
  parent_id   int REFERENCES categories(id),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  type        category_type NOT NULL DEFAULT 'service',
  keywords    text[] NOT NULL DEFAULT '{}',
  -- Dynamic lead form fields, e.g. [{"key":"tonnage","label":"AC tonnage","type":"select","options":["1","1.5","2"]}]
  fields      jsonb NOT NULL DEFAULT '[]',
  active      boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0
);
CREATE INDEX categories_parent_idx ON categories(parent_id);

-- Quotation fee rules. The most specific active rule wins:
-- subcategory+city > subcategory > category+city > category > global default (admin_settings).
CREATE TABLE pricing_rules (
  id              serial PRIMARY KEY,
  category_id     int NOT NULL REFERENCES categories(id),
  city_id         int REFERENCES cities(id),
  fee_paise       int NOT NULL CHECK (fee_paise >= 0),
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_by      bigint REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pricing_rules_lookup_idx ON pricing_rules(category_id, city_id, effective_from DESC);

CREATE TYPE vendor_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');

CREATE TABLE vendors (
  user_id            bigint PRIMARY KEY REFERENCES users(id),
  business_name      text NOT NULL,
  description        text NOT NULL DEFAULT '',
  business_type      category_type NOT NULL DEFAULT 'service',
  city_id            int NOT NULL REFERENCES cities(id),
  lat                double precision NOT NULL,
  lng                double precision NOT NULL,
  -- Vendors in nearby cities receive leads when the lead falls inside their radius.
  service_radius_km  int NOT NULL DEFAULT 15 CHECK (service_radius_km BETWEEN 1 AND 300),
  gst_number         text,
  status             vendor_status NOT NULL DEFAULT 'pending',
  max_active_leads   int NOT NULL DEFAULT 50,
  rating             numeric(3,2) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendors_geo_idx ON vendors(status, lat, lng);

CREATE TABLE vendor_categories (
  vendor_id    bigint NOT NULL REFERENCES vendors(user_id) ON DELETE CASCADE,
  category_id  int NOT NULL REFERENCES categories(id),
  PRIMARY KEY (category_id, vendor_id)
);

CREATE TYPE lead_status AS ENUM (
  'submitted', 'under_review', 'vendors_notified', 'quotes_received',
  'vendor_selected', 'completed', 'expired', 'cancelled', 'no_response', 'disputed'
);

CREATE TABLE leads (
  id            bigserial PRIMARY KEY,
  customer_id   bigint NOT NULL REFERENCES users(id),
  category_id   int NOT NULL REFERENCES categories(id),
  city_id       int NOT NULL REFERENCES cities(id),
  locality_id   int REFERENCES localities(id),
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  title         text NOT NULL,
  description   text NOT NULL,
  details       jsonb NOT NULL DEFAULT '{}',
  -- Precise address is private, same as phone/email.
  address       text,
  budget_paise  int,
  needed_by     date,
  status        lead_status NOT NULL DEFAULT 'submitted',
  flagged       boolean NOT NULL DEFAULT false,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_customer_idx ON leads(customer_id, created_at DESC);
CREATE INDEX leads_city_status_idx ON leads(city_id, status, created_at DESC);

CREATE TYPE assignment_status AS ENUM ('notified', 'viewed', 'declined', 'quoted');

CREATE TABLE lead_vendors (
  lead_id      bigint NOT NULL REFERENCES leads(id),
  vendor_id    bigint NOT NULL REFERENCES vendors(user_id),
  status       assignment_status NOT NULL DEFAULT 'notified',
  distance_km  numeric(7,2) NOT NULL,
  notified_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lead_id, vendor_id)
);
CREATE INDEX lead_vendors_vendor_idx ON lead_vendors(vendor_id, notified_at DESC);

CREATE TYPE quotation_status AS ENUM ('submitted', 'accepted', 'rejected', 'withdrawn');

CREATE TABLE quotations (
  id               bigserial PRIMARY KEY,
  lead_id          bigint NOT NULL REFERENCES leads(id),
  vendor_id        bigint NOT NULL REFERENCES vendors(user_id),
  amount_paise     int NOT NULL CHECK (amount_paise >= 0),
  description      text NOT NULL,
  -- [{"label":"Labour","amount_paise":50000}, ...]
  items            jsonb NOT NULL DEFAULT '[]',
  completion_days  int,
  warranty         text,
  valid_until      date,
  status           quotation_status NOT NULL DEFAULT 'submitted',
  fee_paise        int NOT NULL,
  revision         int NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- One chargeable quotation per vendor per lead: makes double charging impossible.
  UNIQUE (lead_id, vendor_id)
);

CREATE TABLE lead_selections (
  lead_id       bigint PRIMARY KEY REFERENCES leads(id),
  quotation_id  bigint NOT NULL UNIQUE REFERENCES quotations(id),
  vendor_id     bigint NOT NULL REFERENCES vendors(user_id),
  selected_at   timestamptz NOT NULL DEFAULT now()
);

-- Wallet: balance is a cached value; wallet_transactions is the source of truth (append-only ledger).
CREATE TABLE wallets (
  vendor_id      bigint PRIMARY KEY REFERENCES vendors(user_id),
  balance_paise  bigint NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE wallet_tx_type AS ENUM ('recharge', 'quote_fee', 'refund', 'promo_credit', 'adjustment');

CREATE TABLE wallet_transactions (
  id                   bigserial PRIMARY KEY,
  vendor_id            bigint NOT NULL REFERENCES vendors(user_id),
  type                 wallet_tx_type NOT NULL,
  amount_paise         bigint NOT NULL,          -- positive = credit, negative = debit
  balance_after_paise  bigint NOT NULL,
  reference            text NOT NULL UNIQUE,     -- idempotency key, e.g. quote:123, pay:rzp_abc
  lead_id              bigint REFERENCES leads(id),
  quotation_id         bigint REFERENCES quotations(id),
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_tx_vendor_idx ON wallet_transactions(vendor_id, created_at DESC);

CREATE TABLE conversations (
  id          bigserial PRIMARY KEY,
  lead_id     bigint NOT NULL REFERENCES leads(id),
  vendor_id   bigint NOT NULL REFERENCES vendors(user_id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, vendor_id)
);

CREATE TABLE messages (
  id               bigserial PRIMARY KEY,
  conversation_id  bigint NOT NULL REFERENCES conversations(id),
  sender_id        bigint NOT NULL REFERENCES users(id),
  body             text NOT NULL,
  -- True when contact details were detected and redacted.
  redacted         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_idx ON messages(conversation_id, id);

CREATE TABLE admin_settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    bigint REFERENCES users(id),
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO admin_settings (key, value) VALUES
  ('default_quote_fee_paise', '1000'),          -- Rs 10
  ('max_vendors_per_lead', '10'),
  ('lead_expiry_hours', '72'),
  -- 'after_selection' (Phase 1) or 'never' (Phase 2: MyCity-only communication)
  ('contact_reveal_mode', '"after_selection"');
