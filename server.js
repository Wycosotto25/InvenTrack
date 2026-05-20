// ============================================================
//  InvenTrack — server.js
//  Database: inventrack1
//  Tables: roles, users, categories, products, inventory_logs
// ============================================================

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const db      = require("./db");

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================================
//  MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());

// Serve frontend static files
const FRONTEND_DIR = __dirname;
app.use(express.static(FRONTEND_DIR));
console.log("📁 Serving frontend from:", FRONTEND_DIR);

// ============================================================
//  AUTH API — LOGIN (uses users + roles join)
// ============================================================
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    // NOTE: In production, use bcrypt to compare hashed passwords.
    // For this system we do a plain comparison.
    const [results] = await db.query(
      `SELECT u.id, u.username, u.full_name AS displayName, r.name AS role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.username = ? AND u.password = ? AND u.is_active = TRUE`,
      [username, password]
    );

    if (results.length > 0) {
      const user = results[0];
      // Update last_login
      await db.query("UPDATE users SET last_login = NOW() WHERE id = ?", [user.id]);
      res.json({
        id:          user.id,
        username:    user.username,
        displayName: user.displayName || user.username,
        role:        user.role
      });
    } else {
      res.status(401).json({ error: "Incorrect username or password. Please try again." });
    }
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
//  HELPER — get one product (formatted) by id
// ============================================================
async function getProductById(id) {
  const [rows] = await db.query(
    `SELECT p.id, p.name,
            c.name AS category, c.id AS category_id,
            p.quantity, p.price, p.description,
            DATE_FORMAT(p.dateAdded, '%Y-%m-%d') AS dateAdded,
            u.username AS added_by_username,
            u.full_name AS added_by_name,
            p.added_by
     FROM products p
     JOIN categories c ON p.category_id = c.id
     LEFT JOIN users u ON p.added_by = u.id
     WHERE p.id = ?`,
    [id]
  );
  return rows[0] || null;
}

// ============================================================
//  PRODUCTS API
// ============================================================

// GET all products
app.get("/api/products", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.name,
              c.name AS category, c.id AS category_id,
              p.quantity, p.price, p.description,
              DATE_FORMAT(p.dateAdded, '%Y-%m-%d') AS dateAdded,
              u.full_name AS added_by_name,
              p.added_by
       FROM products p
       JOIN categories c ON p.category_id = c.id
       LEFT JOIN users u ON p.added_by = u.id
       ORDER BY p.id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("GET /api/products:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET single product
app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (err) {
    console.error("GET /api/products/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST — add product
app.post("/api/products", async (req, res) => {
  try {
    const { name, category_id, quantity, price, description, added_by } = req.body;

    if (!name || !category_id || quantity === undefined || price === undefined) {
      return res.status(400).json({ error: "name, category_id, quantity, and price are required." });
    }

    const [result] = await db.query(
      `INSERT INTO products (name, category_id, quantity, price, description, dateAdded, added_by)
       VALUES (?, ?, ?, ?, ?, CURDATE(), ?)`,
      [name, category_id, quantity, price, description || null, added_by || null]
    );

    // Log the action
    await db.query(
      `INSERT INTO inventory_logs (product_id, changed_by, action, qty_before, qty_after, note)
       VALUES (?, ?, 'ADD', 0, ?, 'Product added via system')`,
      [result.insertId, added_by || null, quantity]
    );

    const product = await getProductById(result.insertId);
    res.status(201).json(product);
  } catch (err) {
    console.error("POST /api/products:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT — update product
app.put("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category_id, quantity, price, description, updated_by } = req.body;

    const [check] = await db.query("SELECT id, quantity FROM products WHERE id = ?", [id]);
    if (!check.length) return res.status(404).json({ error: "Product not found" });

    const oldQty = check[0].quantity;

    await db.query(
      `UPDATE products SET name=?, category_id=?, quantity=?, price=?, description=?, updatedAt=NOW()
       WHERE id=?`,
      [name, category_id, quantity, price, description || null, id]
    );

    // Log the update
    const action = quantity !== oldQty ? 'RESTOCK' : 'UPDATE';
    await db.query(
      `INSERT INTO inventory_logs (product_id, changed_by, action, qty_before, qty_after, note)
       VALUES (?, ?, ?, ?, ?, 'Product updated via system')`,
      [id, updated_by || null, action, oldQty, quantity]
    );

    const product = await getProductById(id);
    res.json(product);
  } catch (err) {
    console.error("PUT /api/products/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE — remove product
app.delete("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deleted_by = req.query.deleted_by || null;

    const [check] = await db.query("SELECT id, name, quantity FROM products WHERE id = ?", [id]);
    if (!check.length) return res.status(404).json({ error: "Product not found" });

    // Log before deleting (cascade will remove logs too, so log first with a note)
    await db.query(
      `INSERT INTO inventory_logs (product_id, changed_by, action, qty_before, qty_after, note)
       VALUES (?, ?, 'DELETE', ?, 0, ?)`,
      [id, deleted_by, check[0].quantity, `Product "${check[0].name}" deleted from system`]
    );

    await db.query("DELETE FROM products WHERE id = ?", [id]);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("DELETE /api/products/:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  CATEGORIES API
// ============================================================

app.get("/api/categories", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, category_group, description FROM categories ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  USERS API
// ============================================================

// GET all users
app.get("/api/users", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.username, u.email, u.full_name, u.is_active,
              r.name AS role, u.last_login,
              DATE_FORMAT(u.createdAt, '%Y-%m-%d') AS createdAt
       FROM users u
       JOIN roles r ON u.role_id = r.id
       ORDER BY u.id ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — add user
app.post("/api/users", async (req, res) => {
  try {
    const { username, email, password, full_name, role_id } = req.body;
    if (!username || !email || !password || !role_id) {
      return res.status(400).json({ error: "username, email, password, and role_id are required." });
    }

    const [result] = await db.query(
      `INSERT INTO users (username, email, password, full_name, role_id)
       VALUES (?, ?, ?, ?, ?)`,
      [username, email, password, full_name || null, role_id]
    );

    const [rows] = await db.query(
      `SELECT u.id, u.username, u.email, u.full_name, u.is_active,
              r.name AS role, u.last_login,
              DATE_FORMAT(u.createdAt, '%Y-%m-%d') AS createdAt
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`,
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: "Username or email already exists." });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT — update user
app.put("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, full_name, role_id, is_active, password } = req.body;

    const [check] = await db.query("SELECT id FROM users WHERE id = ?", [id]);
    if (!check.length) return res.status(404).json({ error: "User not found" });

    let query, params;
    if (password) {
      query  = `UPDATE users SET username=?, email=?, full_name=?, role_id=?, is_active=?, password=? WHERE id=?`;
      params = [username, email, full_name, role_id, is_active, password, id];
    } else {
      query  = `UPDATE users SET username=?, email=?, full_name=?, role_id=?, is_active=? WHERE id=?`;
      params = [username, email, full_name, role_id, is_active, id];
    }

    await db.query(query, params);
    const [rows] = await db.query(
      `SELECT u.id, u.username, u.email, u.full_name, u.is_active,
              r.name AS role, u.last_login,
              DATE_FORMAT(u.createdAt, '%Y-%m-%d') AS createdAt
       FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
      [id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: "Username or email already exists." });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE — remove user
app.delete("/api/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [check] = await db.query("SELECT id FROM users WHERE id = ?", [id]);
    if (!check.length) return res.status(404).json({ error: "User not found" });
    await db.query("DELETE FROM users WHERE id = ?", [id]);
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  ROLES API
// ============================================================
app.get("/api/roles", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT id, name, description FROM roles ORDER BY id ASC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  INVENTORY LOGS API
// ============================================================

// GET logs (with optional product_id filter)
app.get("/api/logs", async (req, res) => {
  try {
    const { product_id, limit = 100 } = req.query;
    let query = `
      SELECT l.id, 
             COALESCE(p.name, 'Deleted Product') AS product_name, 
             u.full_name AS changed_by_name,
             u.username AS changed_by_username,
             l.action, l.qty_before, l.qty_after, l.note,
             DATE_FORMAT(l.loggedAt, '%Y-%m-%d %H:%i:%s') AS loggedAt
      FROM inventory_logs l
      LEFT JOIN products p ON l.product_id = p.id
      LEFT JOIN users u ON l.changed_by = u.id
    `;
    
    // ... rest of the existing route logic stays the same
    const params = [];

    if (product_id) {
      query += " WHERE l.product_id = ?";
      params.push(product_id);
    }

    query += " ORDER BY l.loggedAt DESC LIMIT ?";
    params.push(parseInt(limit));

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — manual log entry
app.post("/api/logs", async (req, res) => {
  try {
    const { product_id, changed_by, action, qty_before, qty_after, note } = req.body;
    if (!product_id || !action) {
      return res.status(400).json({ error: "product_id and action are required." });
    }
    const [result] = await db.query(
      `INSERT INTO inventory_logs (product_id, changed_by, action, qty_before, qty_after, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [product_id, changed_by || null, action, qty_before || null, qty_after || null, note || null]
    );
    res.status(201).json({ id: result.insertId, message: "Log entry created." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  DASHBOARD STATS API
// ============================================================
app.get("/api/stats", async (req, res) => {
  try {
    const [[{ total }]]     = await db.query("SELECT COUNT(*) AS total FROM products");
    const [[{ totalQty }]]  = await db.query("SELECT SUM(quantity) AS totalQty FROM products");
    const [[{ lowStock }]]  = await db.query("SELECT COUNT(*) AS lowStock FROM products WHERE quantity < 10");
    const [[{ totalValue }]]= await db.query("SELECT SUM(quantity * price) AS totalValue FROM products");

    res.json({
      totalProducts: total,
      totalStock:    totalQty || 0,
      lowStock:      lowStock,
      totalValue:    totalValue || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 InvenTrack running — open: http://localhost:${PORT}`);
});