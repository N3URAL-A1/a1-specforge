-- ALTER TABLE FK + a $$ function body (must be treated as opaque, header-only)
CREATE TABLE order_items (
  id serial PRIMARY KEY,
  order_id bigint NOT NULL,
  qty int NOT NULL DEFAULT 1
);

ALTER TABLE order_items
  ADD CONSTRAINT order_items_order_fk
  FOREIGN KEY (order_id) REFERENCES orders (id);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION audit_log() RETURNS trigger AS $$
BEGIN
  INSERT INTO audit (tbl, at) VALUES (TG_TABLE_NAME, now()); -- semicolons inside $$ must not split
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_items_audit_trg
  AFTER INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION audit_log();
