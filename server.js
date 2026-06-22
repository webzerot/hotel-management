const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

// Χρησιμοποιούμε το Transaction Pooler (port 6543) με connectionString
// ώστε το sslmode=require να μεταφερθεί σωστά στον driver
const pool = new Pool({
  connectionString: 'postgresql://postgres.mzdecptbtpgkzpbplwjp:hotel-management1@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
  ssl: {
    rejectUnauthorized: false   // ← αυτό παρακάμπτει το self-signed cert
  },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test σύνδεσης κατά την εκκίνηση — βλέπεις στα Render logs αν δουλεύει
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Αποτυχία σύνδεσης με Supabase:', err.message);
  } else {
    console.log('✅ Σύνδεση με Supabase επιτυχής!');
    release();
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Query error:', err.message);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  const { name, stock, min_required, supplier } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO products (name, stock, min_required, supplier) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, stock, min_required, supplier]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Insert error:', err.message);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
