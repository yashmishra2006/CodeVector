const { Pool } = require("pg");

// Create a connection pool from DATABASE_URL
// Pool reuses connections — avoids the overhead of connecting per query
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Sensible defaults for a small free-tier deployment
  max: 10, // max simultaneous connections
  idleTimeoutMillis: 30000, // close idle connections after 30s
  connectionTimeoutMillis: 5000, // fail fast if DB is unreachable
  ssl: false,
});

// Log pool errors (don't crash the server)
pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err.message);
});

module.exports = pool;
