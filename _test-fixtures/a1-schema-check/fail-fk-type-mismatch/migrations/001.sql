CREATE TABLE users (
  id bigserial PRIMARY KEY,
  email varchar(255) NOT NULL
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER users_audit_trg AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION audit_log();

-- user_id is integer, but users.id is bigserial (= bigint) → Check C must fail
CREATE TABLE orders (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id)
);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER orders_audit_trg AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION audit_log();
