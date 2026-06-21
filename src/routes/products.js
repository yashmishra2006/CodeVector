const express = require("express");
const pool = require("../db");

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/products
//
// Cursor-based pagination — stable under concurrent inserts/updates.
//
// Query params:
//   category  (optional)  — filter by exact category name
//   cursor    (optional)  — Base64-encoded JSON {created_at, id} from previous page
//   limit     (optional)  — page size, default 20, max 100
//
// Why cursor-based?
//   OFFSET pagination breaks when rows are inserted/deleted between page fetches:
//   rows shift, causing duplicates or gaps. Cursor pagination anchors to the last
//   seen (created_at, id) tuple, so new inserts above the cursor don't affect
//   subsequent pages. The composite index (created_at DESC, id DESC) ensures this
//   is always an index range scan — O(log n + page_size), fast at any depth.
// ---------------------------------------------------------------------------
router.get("/products", async (req, res) => {
  try {
    const category = req.query.category || null;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);

    let cursorCreatedAt = null;
    let cursorId = null;

    // Decode cursor if provided
    if (req.query.cursor) {
      try {
        const decoded = JSON.parse(
          Buffer.from(req.query.cursor, "base64").toString("utf-8")
        );
        cursorCreatedAt = decoded.created_at;
        cursorId = decoded.id;
      } catch {
        return res.status(400).json({ error: "Invalid cursor format" });
      }
    }

    // Build the query dynamically based on whether we have a cursor and/or category
    // We fetch limit + 1 to determine if there are more pages
    let query;
    let params;

    if (cursorCreatedAt && cursorId) {
      if (category) {
        // Category filter + cursor
        query = `
          SELECT id, name, category, price, created_at, updated_at
          FROM products
          WHERE category = $1
            AND (created_at, id) < ($2::timestamptz, $3::uuid)
          ORDER BY created_at DESC, id DESC
          LIMIT $4
        `;
        params = [category, cursorCreatedAt, cursorId, limit + 1];
      } else {
        // No category filter, with cursor
        query = `
          SELECT id, name, category, price, created_at, updated_at
          FROM products
          WHERE (created_at, id) < ($1::timestamptz, $2::uuid)
          ORDER BY created_at DESC, id DESC
          LIMIT $3
        `;
        params = [cursorCreatedAt, cursorId, limit + 1];
      }
    } else {
      if (category) {
        // Category filter, first page (no cursor)
        query = `
          SELECT id, name, category, price, created_at, updated_at
          FROM products
          WHERE category = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2
        `;
        params = [category, limit + 1];
      } else {
        // No filters, first page
        query = `
          SELECT id, name, category, price, created_at, updated_at
          FROM products
          ORDER BY created_at DESC, id DESC
          LIMIT $1
        `;
        params = [limit + 1];
      }
    }

    const { rows } = await pool.query(query, params);

    // Determine if there's a next page
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    // Build the next cursor from the last item in this page
    let nextCursor = null;
    if (hasMore && data.length > 0) {
      const lastItem = data[data.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({
          created_at: lastItem.created_at,
          id: lastItem.id,
        })
      ).toString("base64");
    }

    // Get approximate total count (fast — reads from pg_class stats, not a full scan)
    // For category-filtered counts, we do an exact COUNT (categories are few enough)
    let totalCount;
    if (category) {
      const countResult = await pool.query(
        "SELECT COUNT(*) FROM products WHERE category = $1",
        [category]
      );
      totalCount = parseInt(countResult.rows[0].count);
    } else {
      const countResult = await pool.query(
        "SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = 'products'"
      );
      totalCount = countResult.rows[0]?.estimate ?? 0;
    }

    res.json({
      data,
      pagination: {
        next_cursor: nextCursor,
        has_more: hasMore,
        limit,
      },
      meta: {
        total_count: totalCount,
        category: category,
      },
    });
  } catch (err) {
    console.error("Error fetching products:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/categories
// Returns the distinct list of categories for the filter dropdown.
// ---------------------------------------------------------------------------
router.get("/categories", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT DISTINCT category FROM products ORDER BY category"
    );
    res.json({ data: rows.map((r) => r.category) });
  } catch (err) {
    console.error("Error fetching categories:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
