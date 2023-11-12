# Changelog and migrations

## 2023-11-12

Breking changes need database migrations if service is already running.

Migrations:

```sql
ALTER TABLE events ADD COLUMN api_key VARCHAR(255);
ALTER TABLE messages ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE messages ADD COLUMN user_id bigint REFERENCES users(id);
ALTER TABLE messages ADD COLUMN time TIMESTAMP;
ALTER TABLE users ADD COLUMN created_at TIMESTAMP;
```
