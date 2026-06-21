// ---------------------------------------------------------------------------
// seed.js — Generates 200,000 products using batched multi-row INSERTs.
//
// Why this approach?
//   - Single-row INSERT in a loop would mean 200,000 round trips — very slow.
//   - We batch 5,000 rows per INSERT statement (40 batches total).
//   - Each batch builds a parameterized VALUES list: ($1,$2,$3,$4,$5,$6), ...
//   - This is dramatically faster: ~2-5 seconds vs. minutes.
//
// Usage: node seed.js
// ---------------------------------------------------------------------------
require("dotenv").config();

const { Pool } = require("pg");

const TOTAL_PRODUCTS = 200_000;
const BATCH_SIZE = 5_000; // rows per INSERT — sweet spot for parameterized queries

// Realistic product categories
const CATEGORIES = [
  "Electronics",
  "Clothing",
  "Home & Kitchen",
  "Books",
  "Sports & Outdoors",
  "Beauty & Personal Care",
  "Toys & Games",
  "Automotive",
  "Health & Wellness",
  "Office Supplies",
  "Pet Supplies",
  "Garden & Outdoor",
];

// Template parts for generating product names
const ADJECTIVES = [
  "Premium", "Classic", "Ultra", "Pro", "Essential", "Deluxe",
  "Compact", "Advanced", "Eco", "Smart", "Turbo", "Elite",
  "Vintage", "Modern", "Portable", "Heavy-Duty", "Slim", "Wireless",
];

const NOUNS = [
  "Widget", "Gadget", "Device", "Tool", "Kit", "Set",
  "Bundle", "Pack", "System", "Unit", "Module", "Station",
  "Organizer", "Holder", "Adapter", "Controller", "Monitor", "Sensor",
];

const VARIANTS = [
  "X1", "X2", "Pro", "Max", "Mini", "Plus", "Lite", "S", "XL",
  "2000", "3000", "V2", "V3", "SE", "GT", "Air", "Neo", "Edge",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPrice() {
  // Price between 1.99 and 999.99
  return (Math.random() * 998 + 1.99).toFixed(2);
}

function randomTimestamp() {
  // Spread across the last 365 days
  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const ts = new Date(oneYearAgo + Math.random() * (now - oneYearAgo));
  return ts.toISOString();
}

function generateProductName() {
  return `${randomFrom(ADJECTIVES)} ${randomFrom(NOUNS)} ${randomFrom(VARIANTS)}`;
}

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------
async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });

  console.log(`Seeding ${TOTAL_PRODUCTS.toLocaleString()} products...`);
  const startTime = Date.now();

  // Clear existing data
  await pool.query("DELETE FROM products");
  console.log("Cleared existing products.");

  const totalBatches = Math.ceil(TOTAL_PRODUCTS / BATCH_SIZE);

  for (let batch = 0; batch < totalBatches; batch++) {
    const rowsInBatch = Math.min(BATCH_SIZE, TOTAL_PRODUCTS - batch * BATCH_SIZE);
    const values = [];
    const params = [];

    for (let i = 0; i < rowsInBatch; i++) {
      const paramOffset = i * 4; // 4 user-supplied columns per row (id is auto-generated)
      const name = generateProductName();
      const category = randomFrom(CATEGORIES);
      const price = randomPrice();
      const createdAt = randomTimestamp();

      // ($1, $2, $3, $4) for each row
      values.push(
        `($${paramOffset + 1}, $${paramOffset + 2}, $${paramOffset + 3}, $${paramOffset + 4})`
      );
      params.push(name, category, price, createdAt);
    }

    const query = `
      INSERT INTO products (name, category, price, created_at)
      VALUES ${values.join(", ")}
    `;

    await pool.query(query, params);

    const progress = (((batch + 1) / totalBatches) * 100).toFixed(0);
    console.log(
      `  Batch ${batch + 1}/${totalBatches} (${progress}%) — ${rowsInBatch.toLocaleString()} rows`
    );
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone! ${TOTAL_PRODUCTS.toLocaleString()} products seeded in ${elapsed}s.`);

  // Quick verification
  const { rows } = await pool.query("SELECT COUNT(*) FROM products");
  console.log(`Verification: ${parseInt(rows[0].count).toLocaleString()} rows in products table.`);

  await pool.end();
}

seed().catch((err) => {
  console.error("Seeding failed:", err.message);
  process.exit(1);
});
