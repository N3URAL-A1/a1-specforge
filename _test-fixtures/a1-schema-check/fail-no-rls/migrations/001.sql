CREATE TABLE users (
  id serial PRIMARY KEY,
  email varchar(255) NOT NULL
);
-- no ENABLE ROW LEVEL SECURITY → Check B must fail
CREATE TRIGGER users_audit_trg AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION audit_log();
