-- Photos for leads, quotations and vendor profiles.
-- Files are uploaded first (entity_id NULL), then linked when the lead/quote/profile is saved.
CREATE TYPE attachment_kind AS ENUM ('lead', 'quotation', 'vendor');

CREATE TABLE attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      bigint NOT NULL REFERENCES users(id),
  kind          attachment_kind NOT NULL,
  entity_id     bigint,                -- leads.id / quotations.id / vendors.user_id once linked
  storage_key   text NOT NULL UNIQUE,
  content_type  text NOT NULL,
  bytes         int NOT NULL,
  width         int NOT NULL,
  height        int NOT NULL,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_entity_idx ON attachments(kind, entity_id, sort_order);
CREATE INDEX attachments_unlinked_idx ON attachments(created_at) WHERE entity_id IS NULL;
