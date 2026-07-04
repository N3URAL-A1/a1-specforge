/* orders: inline FK + table-level PK */
CREATE TABLE orders (
  id bigserial,
  user_id integer NOT NULL REFERENCES users(id),
  amount_cents bigint NOT NULL,
  note text,
  PRIMARY KEY (id)
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER orders_audit_trg
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION audit_log();
