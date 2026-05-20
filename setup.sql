CREATE DATABASE IF NOT EXISTS inventrack1
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE inventrack1;

CREATE TABLE IF NOT EXISTS roles (
  id          TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  NAME        VARCHAR(30)   NOT NULL UNIQUE,
  DESCRIPTION VARCHAR(120)  DEFAULT NULL,
  createdAt   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(40)   NOT NULL UNIQUE,
  email         VARCHAR(120)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  full_name     VARCHAR(100)  DEFAULT NULL,
  role_id       TINYINT UNSIGNED NOT NULL,
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  last_login    DATETIME      DEFAULT NULL,
  createdAt     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updatedAt     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_users_role
    FOREIGN KEY (role_id) REFERENCES roles (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
  id             SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  NAME           VARCHAR(60)   NOT NULL UNIQUE,
  category_group VARCHAR(40)   DEFAULT NULL,
  DESCRIPTION    VARCHAR(150)  DEFAULT NULL,
  createdAt      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  NAME          VARCHAR(80)       NOT NULL,
  category_id   SMALLINT UNSIGNED NOT NULL,
  quantity      INT               NOT NULL DEFAULT 0,
  price         DECIMAL(12,2)     NOT NULL DEFAULT 0.00,
  DESCRIPTION   VARCHAR(200)      DEFAULT NULL,
  dateAdded     DATE              NOT NULL,
  added_by      INT UNSIGNED      DEFAULT NULL,
  createdAt     TIMESTAMP         DEFAULT CURRENT_TIMESTAMP,
  updatedAt     TIMESTAMP         DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_products_category
    FOREIGN KEY (category_id) REFERENCES categories (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT fk_products_user
    FOREIGN KEY (added_by) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_logs (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id    INT UNSIGNED     NOT NULL,
  changed_by    INT UNSIGNED     DEFAULT NULL,
  ACTION        ENUM('ADD','UPDATE','DELETE','RESTOCK','ADJUST') NOT NULL,
  qty_before    INT              DEFAULT NULL,
  qty_after     INT              DEFAULT NULL,
  note          VARCHAR(200)     DEFAULT NULL,
  loggedAt      TIMESTAMP        DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_log_product
    FOREIGN KEY (product_id) REFERENCES products (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  CONSTRAINT fk_log_user
    FOREIGN KEY (changed_by) REFERENCES users (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=INNODB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_products_category  ON products (category_id);
CREATE INDEX idx_products_added_by  ON products (added_by);
CREATE INDEX idx_products_name      ON products (NAME);
CREATE INDEX idx_logs_product       ON inventory_logs(product_id);
CREATE INDEX idx_logs_user          ON inventory_logs(changed_by);
CREATE INDEX idx_users_role         ON users (role_id);

INSERT INTO roles (NAME, DESCRIPTION) VALUES
  ('admin',  'Full access: create, read, update, delete all records'),
  ('staff',  'Can add and update products; cannot delete or manage users'),
  ('viewer', 'Read-only access to inventory and reports');

INSERT INTO users (username, email, password_hash, full_name, role_id) VALUES
  ('admin',     'admin@inventrack.local',    '$2b$12$EixZaYVK1fsbw1Zfbx3OXePaWxn96p36IKSt4hqkqY2S9Sp9TBIKi', 'Admin User',     1),
  ('jdelacruz', 'jdelacruz@inventrack.local','$2b$12$EixZaYVK1fsbw1Zfbx3OXePaWxn96p36IKSt4hqkqY2S9Sp9TBIKi', 'Juan Dela Cruz', 2),
  ('mreyes',    'mreyes@inventrack.local',   '$2b$12$EixZaYVK1fsbw1Zfbx3OXePaWxn96p36IKSt4hqkqY2S9Sp9TBIKi', 'Maria Reyes',    2),
  ('bsantos',   'bsantos@inventrack.local',  '$2b$12$EixZaYVK1fsbw1Zfbx3OXePaWxn96p36IKSt4hqkqY2S9Sp9TBIKi', 'Bong Santos',    3);

INSERT INTO categories (NAME, category_group, DESCRIPTION) VALUES
  ('Electronics',     'Technology',  'Electronic devices, gadgets, and accessories'),
  ('Office Supplies', 'Office',      'Consumables and tools for office use'),
  ('Furniture',       'Office',      'Desks, chairs, and workspace fixtures'),
  ('Clothing',        'Apparel',     'Wearable items and uniforms'),
  ('Food & Beverage', 'Consumables', 'Edible products and drinks for the workplace'),
  ('Tools & Hardware','Operations',  'Physical tools and mechanical hardware'),
  ('Health & Safety', 'Operations',  'PPE and hygiene products'),
  ('Other',           'General',     'Uncategorized miscellaneous items');

INSERT INTO products (NAME, category_id, quantity, price, DESCRIPTION, dateAdded, added_by) VALUES
  ('Wireless Keyboard',    1, 45,  899.00,  'Bluetooth mechanical keyboard',           '2025-01-10', 1),
  ('USB-C Hub',            1,  8, 1250.00,  '7-in-1 USB-C docking station',            '2025-01-15', 1),
  ('Office Chair',         3, 12, 5500.00,  'Ergonomic mesh back chair',               '2025-02-01', 2),
  ('Ballpen Pack',         2,  4,   55.00,  'Pack of 12 black ballpens',               '2025-02-05', 2),
  ('Standing Desk',        3,  3,14500.00,  'Height-adjustable standing desk',         '2025-02-10', 2),
  ('Webcam HD',            1, 22, 2300.00,  '1080p Full HD USB webcam',                '2025-03-01', 1),
  ('Printer Paper A4',     2, 60,  280.00,  '500-sheet A4 bond paper ream',            '2025-03-05', 3),
  ('Hand Sanitizer 500ml', 7,  7,  120.00,  '70% ethyl alcohol sanitizer',             '2025-03-10', 3),
  ('Safety Helmet',        7, 15,  350.00,  'OSHA-compliant hard hat',                 '2025-03-15', 2),
  ('Power Drill',          6,  9, 3200.00,  'Cordless 18V drill with battery',         '2025-03-20', 2),
  ('T-Shirt (XL)',         4, 30,  180.00,  'Plain white cotton t-shirt size XL',      '2025-04-01', 3),
  ('Instant Coffee 200g',  5, 50,  145.00,  '3-in-1 instant coffee sachets',           '2025-04-05', 3),
  ('Monitor 24in',         1,  6, 9800.00,  'Full HD IPS monitor 24 inch',             '2025-04-10', 1),
  ('Scissors',             2,  2,   65.00,  'Stainless steel office scissors',         '2025-04-12', 2),
  ('Work Gloves',          6, 20,   90.00,  'Heavy-duty leather work gloves',          '2025-04-15', 2);

INSERT INTO inventory_logs (product_id, changed_by, ACTION, qty_before, qty_after, note)
SELECT id, added_by, 'ADD', 0, quantity, 'Initial stock entry on migration'
FROM products;

CREATE OR REPLACE VIEW v_products AS
SELECT
  p.id,
  p.name,
  c.name AS category,
  c.category_group,
  p.quantity,
  p.price,
  p.description,
  p.dateAdded,
  u.username AS added_by_username,
  u.full_name AS added_by_name,
  p.createdAt,
  p.updatedAt
FROM products p
JOIN categories c ON p.category_id = c.id
LEFT JOIN users u ON p.added_by = u.id;

CREATE OR REPLACE VIEW v_low_stock AS
SELECT *
FROM v_products
WHERE quantity <= 10
ORDER BY quantity ASC;

CREATE OR REPLACE VIEW v_inventory_value AS
SELECT
  c.name AS category,
  COUNT(p.id) AS product_count,
  SUM(p.quantity) AS total_units,
  SUM(p.quantity * p.price) AS total_value
FROM products p
JOIN categories c ON p.category_id = c.id
GROUP BY c.id, c.name
ORDER BY total_value DESC;