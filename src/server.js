require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const productRoutes = require("./routes/products");

const app = express();
const PORT = process.env.PORT || 3000;
  
// Middleware
app.use(cors());
app.use(express.json());

// Serve the bonus UI from /public
app.use(express.static(path.join(__dirname, "..", "public")));

// API routes
app.use("/api", productRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
