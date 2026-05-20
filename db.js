// ============================================================
//  InvenTrack — db.js
//  Uses mysql2/promise for async/await support in server.js
// ============================================================

const mysql = require("mysql2/promise");

const db = mysql.createPool({
  host:            process.env.DB_HOST     || "localhost",
  user:            process.env.DB_USER     || "root",
  password:        process.env.DB_PASSWORD || "",       // palitan kung may password ka
  database:        process.env.DB_NAME     || "inventrack1",
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0
});

// Quick connection test on startup
(async () => {
  try {
    const conn = await db.getConnection();
    console.log("✅ Connected to MySQL database: inventrack1");
    conn.release();
  } catch (err) {
    console.error("❌ MySQL connection failed:", err.message);
  }
})();

module.exports = db;