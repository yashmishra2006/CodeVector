# CodeVeda — Product Browser

A backend API for browsing ~200,000 products with **cursor-based pagination** that guarantees no duplicates or missed items, even when data changes during browsing.

## Why Cursor-Based Pagination?

Traditional `OFFSET/LIMIT` pagination breaks when rows are inserted or deleted between page fetches — items shift positions, causing duplicates or gaps. **Cursor pagination** uses the last seen `(created_at, id)` tuple as a stable anchor point. New inserts above the cursor don't affect subsequent pages.

```
Page 1:  ORDER BY created_at DESC, id DESC LIMIT 20           → returns items 1–20
Page 2:  WHERE (created_at, id) < (last_seen) ... LIMIT 20    → returns items 21–40
```

Even if 50 new products are inserted between these requests, Page 2 still returns exactly the right next 20 items.

## Tech Stack

| Component | Choice | Why |
|---|---|---|
| Runtime | Node.js (Express) | Lightweight, fast to build |
| Database | PostgreSQL | Best support for row-value comparisons, composite indexes |
| Hosting | Coolify | Self-hosted platform, shared PostgreSQL service |

## API

### `GET /api/products`

| Param | Required | Description |
|---|---|---|
| `category` | No | Filter by exact category name |
| `cursor` | No | Base64-encoded cursor from previous response |
| `limit` | No | Page size (default: 20, max: 100) |

**Response:**
```json
{
  "data": [{ "id": "...", "name": "...", "category": "...", "price": "9.99", "created_at": "...", "updated_at": "..." }],
  "pagination": { "next_cursor": "...", "has_more": true, "limit": 20 },
  "meta": { "total_count": 200000, "category": null }
}
```

### `GET /api/categories`

Returns distinct category names for the filter dropdown.

### `GET /health`

Health check endpoint.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your DATABASE_URL
```

### 3. Run migrations
```bash
npm run migrate
```

### 4. Seed the database (200,000 products)
```bash
npm run seed
```

### 5. Start the server
```bash
npm run dev    # development (auto-restart on changes)
npm start      # production
```

## Database Schema

```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- These two indexes power the cursor pagination:
CREATE INDEX idx_products_cursor ON products (created_at DESC, id DESC);
CREATE INDEX idx_products_category_cursor ON products (category, created_at DESC, id DESC);
```

## Deployment (Coolify)

1. Push to GitHub
2. In Coolify, create a new service from your repo
3. Set the `DATABASE_URL` environment variable to point to your shared PostgreSQL service
4. Set `NODE_ENV=production`
5. Set `PORT=3000`
6. After first deploy, run migrations and seed:
   ```bash
   # Via Coolify terminal or SSH into the container
   node migrate.js
   node seed.js
   ```

## Project Structure

```
CodeVeda/
├── Dockerfile
├── package.json
├── schema.sql          # Database schema + indexes
├── migrate.js          # Runs schema.sql against the DB
├── seed.js             # Generates 200,000 products (batched bulk inserts)
├── src/
│   ├── server.js       # Express entry point
│   ├── db.js           # PostgreSQL connection pool
│   └── routes/
│       └── products.js # Cursor-based pagination API
├── public/
│   └── index.html      # Bonus: product browser UI
└── README.md
```
