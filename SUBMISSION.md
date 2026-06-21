# CodeVector Take-Home - Submission Notes

## What I Built

A product browsing API serving **200,000 products** with **cursor-based (keyset) pagination**, category filtering, and a bonus UI with bidirectional infinite scroll.

**Live URL**: *(add your Coolify URL here)*  
**Stack**: Node.js (Express) + PostgreSQL 18 + Docker (Coolify)

---

## The Core Problem: Pagination Under Concurrent Mutations

The task requirement states:

> *"If 50 new products are added/updated while someone is browsing, they must not see the same product twice or miss one."*

This single sentence rules out the most common pagination strategy and points to a specific, correct approach.

### Why OFFSET/LIMIT Fails

```sql
-- Page 1
SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 0;
-- User sees items 1–20

-- Meanwhile, 5 new products are inserted...

-- Page 2
SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 20;
-- Items shifted! User sees items 21–40, but items 16–20 moved to positions 21–25.
-- Result: 5 DUPLICATES. Items 21–25 are MISSED entirely.
```

`OFFSET` counts rows from the beginning every time. When rows are inserted above the offset point, everything below shifts - duplicates appear and items are skipped.

### Why Cursor-Based Pagination Works

Instead of counting rows, we anchor to the **last item the user actually saw**:

```sql
-- Page 1 (no cursor - first page)
SELECT * FROM products
ORDER BY created_at DESC, id DESC
LIMIT 20;
-- Returns items with created_at from "2026-06-20" down to "2026-06-15"
-- Last item: (created_at: "2026-06-15T03:00:00Z", id: "abc-123")

-- Page 2 (cursor = last seen item)
SELECT * FROM products
WHERE (created_at, id) < ('2026-06-15T03:00:00Z', 'abc-123')
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

New inserts have `created_at` values **newer** than the cursor - they sort *above* it and never affect results below. The user's position in the dataset is anchored to an immutable point, not a row count.

**Why `(created_at, id)` and not just `created_at`?**  
Multiple products can share the same `created_at` timestamp. Adding `id` (UUID, unique) as a tiebreaker creates a **total ordering** - no two products have the same `(created_at, id)` pair, so no items can be accidentally skipped or duplicated.

---

## Database Design

### Schema

```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Indexes - and Why They Matter

```sql
-- Index 1: Powers unfiltered browsing
CREATE INDEX idx_products_cursor
  ON products (created_at DESC, id DESC);

-- Index 2: Powers category-filtered browsing  
CREATE INDEX idx_products_category_cursor
  ON products (category, created_at DESC, id DESC);
```

**Index 1** ensures that `ORDER BY created_at DESC, id DESC` + `WHERE (created_at, id) < (cursor)` is serviced by a **B-tree range scan** - the database walks the index from the cursor position and reads exactly `LIMIT` entries. No sorting, no sequential scan. This is O(log n + page_size), constant regardless of how deep into the dataset the user has scrolled.

**Index 2** is a **covering composite index** for category queries. PostgreSQL uses the `category` prefix to filter, then walks the remaining `(created_at DESC, id DESC)` portion for ordering and cursor comparison - all within a single index scan.

Without these indexes, the query would require a full table scan + sort, which degrades as OFFSET grows. With them, page 1 and page 10,000 are equally fast.

### Approximate Count for Performance

```sql
-- Instead of: SELECT COUNT(*) FROM products  (scans entire table)
-- We use:
SELECT reltuples::bigint FROM pg_class WHERE relname = 'products';
```

`COUNT(*)` on 200K rows requires a full sequential scan (~30ms). `pg_class.reltuples` returns the planner's cached estimate in microseconds. For a "total products" badge, an estimate is perfectly acceptable. For category-filtered counts, we use exact `COUNT` since the category index makes it fast.

---

## Seed Script: Bulk Insertion

The task says: *"Tip: don't do a slow approach in a loop."*

**Naive approach** (what to avoid):
```js
for (let i = 0; i < 200000; i++) {
  await pool.query("INSERT INTO products VALUES ($1, $2, ...)", [...]);
}
// 200,000 round trips × ~1ms each = ~200 seconds
```

**My approach** - batched multi-row INSERT:
```js
const BATCH_SIZE = 5000; // 40 batches total

// Build: INSERT INTO products VALUES ($1,$2,$3,$4), ($5,$6,$7,$8), ...
// 5,000 rows per statement, parameterized (safe from SQL injection)
const values = [];
const params = [];
for (let i = 0; i < BATCH_SIZE; i++) {
  values.push(`($${i*4+1}, $${i*4+2}, $${i*4+3}, $${i*4+4})`);
  params.push(name, category, price, createdAt);
}
await pool.query(`INSERT INTO products (name, category, price, created_at) VALUES ${values.join(",")}`, params);
```

**Result**: 200,000 rows inserted in **~3-5 seconds** (40 batches × 5,000 rows). Each batch is a single SQL statement with parameterized values - safe, fast, and doesn't hit PostgreSQL's parameter limit.

---

## API Design

### `GET /api/products`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string (Base64) | `null` | Encoded `{created_at, id}` of last seen item |
| `category` | string | `null` | Filter by exact category |
| `limit` | integer | `20` | Page size (max 100) |
| `direction` | string | `forward` | `forward` = older items, `backward` = newer items |

**Response**:
```json
{
  "data": [{ "id": "...", "name": "...", "category": "...", "price": "29.99", "created_at": "...", "updated_at": "..." }],
  "pagination": {
    "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAyNi0wNi...",
    "has_more": true,
    "limit": 20,
    "direction": "forward"
  },
  "meta": { "total_count": 200000, "category": null }
}
```

**How the cursor works**: The cursor is a Base64-encoded JSON object containing `{created_at, id}` of the edge item. The client doesn't need to understand its structure - it's opaque. The server decodes it and uses it in the `WHERE` clause.

**Bidirectional pagination**: The `direction` parameter supports a sliding-window UI. `forward` fetches items older than the cursor (scrolling down). `backward` fetches items newer than the cursor (scrolling back up). Backward queries use `>` comparison with `ASC` ordering, then reverse results before returning - so the response always arrives in consistent `DESC` display order.

### `GET /api/categories`

Returns distinct category names. Used to populate the filter dropdown.

### `GET /health`

Health check for Coolify's monitoring.

---

## Bonus: Sliding Window UI

The frontend implements **bidirectional infinite scroll** with DOM pruning to keep memory low, and features a velocity-aware preloading mechanism.

**The Evolution of the Infinite Scroll Implementation**:

1. **Approach 1: `IntersectionObserver` with small root margin**
   - *Initial try*: Triggered a fetch when a DOM sentinel entered the viewport.
   - *The issue*: Fast scrollers easily outpaced the network. If the user scrolled rapidly, they hit the bottom and saw a white space / loading spinner because the fetch didn't start early enough.

2. **Approach 2: `IntersectionObserver` with massive root margin**
   - *Second try*: Increased `rootMargin` to `4000px` to trigger preloading long before the user hit the bottom.
   - *The issue*: While it masked the network latency, it was rigid and didn't account for actual user behavior. It also loaded data aggressively even if the user was scrolling slowly.

3. **Approach 3: Dynamic Scroll-Velocity Loading (Current)**
   - *Final implementation*: Replaced the static observer with a `scroll` event listener that calculates instantaneous scroll velocity (pixels per millisecond).
   - *How it works*: It multiplies the velocity by expected network latency (e.g., 800ms) to calculate a dynamic `distanceToBottom` threshold. If the user scrolls at 5px/ms, the threshold expands to 4000px+, triggering the load instantly. If they scroll slowly, it triggers at a conservative 1000px limit.
   - *Result*: Zero white space for fast scrollers, and efficient network usage for slow scrollers.

**DOM Windowing**:
- The grid keeps a maximum of **3 pages (600 items)** in the DOM at any time.
- When the window exceeds this limit, the oldest page is removed from the opposite end.
- Scroll position is preserved during pruning using `scrollHeight` delta adjustment, so the user never experiences visual jumps.

---

## What I'd Improve With More Time

1. **Rate limiting and input validation** - Add `express-rate-limit` to prevent abuse, validate and sanitize query parameters more rigorously.

2. **Response compression** - Add `compression` middleware. JSON responses for 20 products are ~3KB, but compression would cut that in half for mobile users.

3. **Database connection pooling tuning** - Currently using `pg` pool defaults. In production, I'd monitor connection usage and tune `max`, `idleTimeoutMillis` based on actual traffic patterns.

4. **Search** - Add a `search` query parameter using PostgreSQL's `ts_vector` full-text search or `ILIKE` with a GIN/trigram index for product name search.

5. **Caching** - For the categories endpoint and total count, add a short TTL cache (Redis or in-memory) since these change infrequently.

6. **Automated tests** - A test that fetches all pages sequentially, collects all IDs, and asserts zero duplicates and zero gaps. Plus a test that inserts products mid-pagination and verifies stability.

7. **Monitoring & observability** - Request logging with response times, `EXPLAIN ANALYZE` output for slow queries, health check that verifies DB connectivity.

---

## How I Used AI

**What AI helped with**:
- Scaffolding the initial project structure (Express boilerplate, Dockerfile, docker-compose)
- Generating the product name templates (adjectives × nouns × variants)
- Writing the CSS for the product browser UI
- Drafting documentation

**What I caught and fixed**:
- **`Buffer` in the browser**: AI used `Buffer.from()` in the frontend JavaScript for Base64 encoding. `Buffer` is a Node.js API - it doesn't exist in browsers. Fixed to use the browser-native `btoa()`. This is a classic mistake when writing both server and client JS in the same project.
- **SSL assumption**: AI defaulted to `ssl: { rejectUnauthorized: false }` for production PostgreSQL. On Coolify, the app and database are on the same internal Docker network - SSL isn't supported or needed. Changed to `ssl: false`.
- **IntersectionObserver stalling**: AI's initial infinite scroll used `IntersectionObserver` alone, which only fires on enter/leave transitions. If the sentinel stays visible after a page load (not enough content to push it off-screen), subsequent pages never load. Added a `scheduleCheck()` fallback that manually checks sentinel visibility after each load.

**Key design decisions I made independently**:
- Choosing cursor-based over offset-based pagination (the core technical decision)
- Designing the composite index strategy `(created_at DESC, id DESC)` with the `id` tiebreaker
- Using `pg_class.reltuples` for approximate counts instead of `COUNT(*)`
- Implementing bidirectional pagination with DOM windowing for memory efficiency

---

## Conclusion

This submission prioritizes **correctness and performance at scale**. By leveraging PostgreSQL's keyset pagination and composite indexes, the backend can safely handle concurrent mutations without duplicating or dropping records, maintaining consistent O(log N) performance regardless of pagination depth. The frontend sliding window ensures the browser remains responsive even when scrolling through thousands of products. I'm looking forward to discussing these architectural choices in the live technical round.
