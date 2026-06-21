-- Products table
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index for cursor-based pagination (newest first)
-- Powers: ORDER BY created_at DESC, id DESC with WHERE (created_at, id) < (cursor)
CREATE INDEX IF NOT EXISTS idx_products_cursor
  ON products (created_at DESC, id DESC);

-- Composite index for category-filtered cursor pagination
-- Powers: WHERE category = $1 AND (created_at, id) < (cursor) ORDER BY created_at DESC, id DESC
CREATE INDEX IF NOT EXISTS idx_products_category_cursor
  ON products (category, created_at DESC, id DESC);
