CREATE INDEX IF NOT EXISTS usage_created_at_idx ON usage_records(json_extract(data,'$.createdAt'));
