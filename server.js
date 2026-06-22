const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  host: 'aws-0-eu-west-1.pooler.supabase.com',  
  port: 5432,                                     
  user: 'postgres.mzdecptbtpgkzpbplwjp',
  password: 'hotel-management1',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  family: 4,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

pool.connect((err, client, release) => {
  if (err) console.error('❌ Αποτυχία σύνδεσης με Supabase:', err.message);
  else { console.log('✅ Σύνδεση με Supabase επιτυχής!'); release(); }
});

app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/products', async (req, res) => {
  let { name, stock, min_required, supplier, suggested_qty } = req.body;
  if (!supplier || supplier.trim() === '') supplier = 'Άγνωστος';
  const sugQty = suggested_qty ? parseInt(suggested_qty) : 5;
  try {
    const result = await pool.query(
      'INSERT INTO products (name, stock, min_required, supplier, suggested_qty) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, stock, min_required, supplier, sugQty]
    );
    await pool.query('INSERT INTO stock_log (product_id, change_amount, reason) VALUES ($1, $2, $3)', [result.rows[0].id, stock, 'Αρχική Εισαγωγή']);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  let { name, min_required, supplier, suggested_qty } = req.body;
  if (!supplier || supplier.trim() === '') supplier = 'Άγνωστος';
  const sugQty = suggested_qty ? parseInt(suggested_qty) : 5;
  try {
    const result = await pool.query(
      'UPDATE products SET name = $1, min_required = $2, supplier = $3, suggested_qty = $4 WHERE id = $5 RETURNING *',
      [name, min_required, supplier, sugQty, id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

// ΝΕΟ ROUTE: ΓΡΗΓΟΡΗ ΑΥΞΟΜΕΙΩΣΗ ΑΠΟΘΕΜΑΤΟΣ (+ / -) ΜΕ ΕΝΑ ΚΛΙΚ
app.post('/api/products/:id/quick-stock', async (req, res) => {
  const { id } = req.params;
  const { change, reason } = req.body; // change: 1 ή -1
  try {
    // Ενημέρωση αποθέματος (με έλεγχο να μην πέσει κάτω από το 0)
    const result = await pool.query(
      'UPDATE products SET stock = GREATEST(0, stock + $1) WHERE id = $2 RETURNING *',
      [change, id]
    );
    // Καταγραφή στα logs
    await pool.query(
      'INSERT INTO stock_log (product_id, change_amount, reason) VALUES ($1, $2, $3)',
      [id, Math.abs(change), reason]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.delete('/api/suppliers/:name', async (req, res) => {
  const { name } = req.params;
  try {
    await pool.query('DELETE FROM products WHERE supplier = $1', [name]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/orders', async (req, res) => {
  const { ordered_by, items } = req.body; 
  try {
    const orderRes = await pool.query('INSERT INTO orders (ordered_by) VALUES ($1) RETURNING *', [ordered_by]);
    const orderId = orderRes.rows[0].id;
    for (let item of items) {
      await pool.query('INSERT INTO order_items (order_id, product_id, requested_qty) VALUES ($1, $2, $3)', [orderId, item.product_id, item.requested_qty]);
    }
    res.json({ success: true, orderId });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.get('/api/orders/pending', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id as order_id, o.ordered_by, o.created_at, o.total_cost, oi.id as item_id, oi.product_id, oi.requested_qty, p.name as product_name, p.supplier
      FROM orders o JOIN order_items oi ON o.id = oi.order_id JOIN products p ON oi.product_id = p.id WHERE o.status = 'Εκκρεμεί' ORDER BY o.id DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.get('/api/orders/all', async (req, res) => {
  try {
    // Πρόσθεσε το received_at στο SELECT
    const result = await pool.query(`
      SELECT o.id as order_id, o.ordered_by, o.status, o.created_at, o.received_at, o.total_cost, oi.requested_qty, oi.received_qty, p.name as product_name, p.supplier
      FROM orders o JOIN order_items oi ON o.id = oi.order_id JOIN products p ON oi.product_id = p.id ORDER BY o.id DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/orders/receive', async (req, res) => {
  const { order_id, items, total_cost } = req.body; 
  const cost = total_cost && total_cost.trim() !== '' ? total_cost.trim() : 'Άγνωστο κόστος';
  try {
    // ΠΡΟΣΘΕΣΑΜΕ ΤΟ received_at = NOW()
    await pool.query("UPDATE orders SET status = 'Παραλήφθηκε', total_cost = $1, received_at = NOW() WHERE id = $2", [cost, order_id]);
    
    for (let item of items) {
      await pool.query('UPDATE order_items SET received_qty = $1 WHERE order_id = $2 AND product_id = $3', [item.received_qty, order_id, item.product_id]);
      await pool.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.received_qty, item.product_id]);
      await pool.query('INSERT INTO stock_log (product_id, change_amount, reason) VALUES ($1, $2, $3)', [item.product_id, item.received_qty, 'Παραλαβή Παραγγελίας']);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

// Επίσης, στο route '/api/orders/all' άλλαξε το SELECT για να φέρνει και το received_at:
app.get('/api/orders/all', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id as order_id, o.ordered_by, o.status, o.created_at, o.received_at, o.total_cost, oi.requested_qty, oi.received_qty, p.name as product_name, p.supplier
      FROM orders o JOIN order_items oi ON o.id = oi.order_id JOIN products p ON oi.product_id = p.id ORDER BY o.id DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.put('/api/orders/:id/cost', async (req, res) => {
  const { id } = req.params;
  const { total_cost } = req.body;
  const cost = total_cost && total_cost.trim() !== '' ? total_cost.trim() : 'Άγνωστο κόστος';
  try {
    await pool.query('UPDATE orders SET total_cost = $1 WHERE id = $2', [cost, id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.delete('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM orders WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.delete('/api/orders/all/clear', async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE orders CASCADE');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.get('/api/analytics/logs', async (req, res) => {
  const { range } = req.query;
  let timeCondition = "";
  if (range === 'week') timeCondition = "WHERE sl.changed_at >= NOW() - INTERVAL '7 days'";
  else if (range === 'month') timeCondition = "WHERE sl.changed_at >= NOW() - INTERVAL '30 days'";
  else if (range === 'year') timeCondition = "WHERE sl.changed_at >= NOW() - INTERVAL '365 days'";
  try {
    const result = await pool.query(`SELECT sl.id, p.name as product_name, sl.change_amount, sl.reason, sl.changed_at FROM stock_log sl JOIN products p ON sl.product_id = p.id ${timeCondition} ORDER BY sl.changed_at DESC LIMIT 200`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.delete('/api/analytics/logs/clear', async (req, res) => {
  const { range } = req.body;
  let query = "";
  if (range === 'week') query = "DELETE FROM stock_log WHERE changed_at >= NOW() - INTERVAL '7 days'";
  else if (range === 'month') query = "DELETE FROM stock_log WHERE changed_at >= NOW() - INTERVAL '30 days'";
  else if (range === 'year') query = "DELETE FROM stock_log WHERE changed_at >= NOW() - INTERVAL '365 days'";
  else if (range === 'all') query = "TRUNCATE TABLE stock_log RESTART IDENTITY CASCADE";
  try {
    await pool.query(query);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/reset-database', async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE order_items, orders, stock_log, products RESTART IDENTITY CASCADE');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
