// ---------------------------------------------------------------------------
// migrate.js - Runs schema.sql against the database
// Usage: node migrate.js
// ---------------------------------------------------------------------------
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
  });

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");

  console.log("Running migrations...");
  await pool.query(schema);
  console.log("Migrations complete.");

  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
