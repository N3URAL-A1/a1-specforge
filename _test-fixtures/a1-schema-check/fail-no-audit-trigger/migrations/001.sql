CREATE TABLE users (
  id serial PRIMARY KEY,
  email varchar(255) NOT NULL
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- no audit/log trigger on users → Check A must fail
CREATE TRIGGER users_touch_trg AFTER UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
