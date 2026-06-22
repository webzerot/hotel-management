const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Χειροκίνητη σύνδεση χωρίς το DATABASE_URL του Render για αποφυγή του IPv6 bug
const pool = new Pool({
  host: 'db.mzdecptbtpgkzpbplwjp.supabase.co',
  port: 5432,
  user: 'postgres',
  password: 'hotel-management1',
  database: 'postgres',
  ssl: {
    rejectUnauthorized: false
  }
});

// GET: Επιστροφή όλων των προϊόντων
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST: Προσθήκη νέου προϊόντος
app.post('/api/products', async (req, res) => {
  const { name, stock, min_required, supplier } = req.body;
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
