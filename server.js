const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

// Απευθείας σύνδεση στην IP για να προσπεράσουμε το IPv6 bug του Render
const pool = new Pool({
  host: '54.93.47.168',
  port: 6543,
  user: 'postgres.mzdecptbtpgkzpbplwjp',
  password: 'hotel-management1',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

// 1. GET: Όλα τα προϊόντα
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 2. POST: Προσθήκη προϊόντος
app.post('/api/products', async (req, res) => {
  let { name, stock, min_required, supplier } = req.body;
  if (!supplier || supplier.trim() === '') supplier = 'Άγνωστος';
  try {
    const result = await pool.query(
      'INSERT INTO products (name, stock, min_required, supplier) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, stock, min_required, supplier]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 3. PUT: Quick Edit Προϊόντος (Inline)
app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  let { name, min_required, supplier } = req.body;
  if (!supplier || supplier.trim() === '') supplier = 'Άγνωστος';
  try {
    const result = await pool.query(
      'UPDATE products SET name = $1, min_required = $2, supplier = $3 WHERE id = $4 RETURNING *',
      [name, min_required, supplier, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 4. POST: Δημιουργία Νέας Παραγγελίας
app.post('/api/orders', async (req, res) => {
  const { ordered_by, items } = req.body; // items: [{product_id, requested_qty}]
  try {
    const orderRes = await pool.query(
      'INSERT INTO orders (ordered_by) VALUES ($1) RETURNING *',
      [ordered_by]
    );
    const orderId = orderRes.rows[0].id;

    for (let item of items) {
      await pool.query(
        'INSERT INTO order_items (order_id, product_id, requested_qty) VALUES ($1, $2, $3)',
        [orderId, item.product_id, item.requested_qty]
      );
    }
    res.json({ success: true, orderId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 5. GET: Λίστα Εκκρεμών Παραγγελιών
app.get('/api/orders/pending', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id as order_id, o.ordered_by, o.created_at, 
             oi.id as item_id, oi.product_id, oi.requested_qty, p.name as product_name, p.supplier
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.status = 'Εκκρεμεί'
      ORDER BY o.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 6. POST: Επιβεβαίωση Παραλαβής
app.post('/api/orders/receive', async (req, res) => {
  const { order_id, items } = req.body; // items: [{product_id, received_qty}]
  try {
    // Ενημέρωση κατάστασης παραγγελίας
    await pool.query("UPDATE orders SET status = 'Παραλήφθηκε' WHERE id = $1", [order_id]);

    for (let item of items) {
      // Ενημέρωση ποσότητας στο order_items
      await pool.query(
        'UPDATE order_items SET received_qty = $1 WHERE order_id = $2 AND product_id = $3',
        [item.received_qty, order_id, item.product_id]
      );
      // Προσθήκη των προϊόντων στο live απόθεμα της αποθήκης
      await pool.query(
        'UPDATE products SET stock = stock + $1 WHERE id = $2',
        [item.received_qty, item.product_id]
      );
      // Καταγραφή στο ιστορικό (Log)
      await pool.query(
        'INSERT INTO stock_log (product_id, change_amount, reason) VALUES ($1, $2, $3)',
        [item.product_id, item.received_qty, 'Παραλαβή Παραγγελίας']
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
