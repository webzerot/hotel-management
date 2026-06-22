const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Σύνδεση με PostgreSQL (Από το Render Environment)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

app.use(express.static(path.join(__dirname, 'public')));

// 1. GET: Λήψη όλων των προϊόντων
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Σφάλμα κατά τη λήψη των προϊόντων" });
    }
});

// 2. POST: Γρήγορη Ενημέρωση Αποθέματος (+/-)
app.post('/api/products/update-stock', async (req, res) => {
    const { product_id, amount, reason } = req.body;
    try {
        await pool.query('BEGIN');
        const updateQuery = 'UPDATE products SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2 RETURNING *';
        const updatedProduct = await pool.query(updateQuery, [amount, product_id]);
        
        await pool.query('INSERT INTO stock_log (product_id, quantity_changed, reason, user_name) VALUES ($1, $2, $3, \'Υπάλληλος Βάρδιας\')', [product_id, amount, reason]);
        await pool.query('COMMIT');
        res.json(updatedProduct.rows[0]);
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: "Αποτυχία ενημέρωσης" });
    }
});

// 3. PUT: Quick Edit (Αλλαγή ονόματος, ορίου, προμηθευτή)
app.put('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const { name, min_required, supplier_name } = req.body;
    try {
        const query = 'UPDATE products SET name = $1, min_required = $2, supplier_name = $3, updated_at = NOW() WHERE id = $4 RETURNING *';
        const result = await pool.query(query, [name, min_required, supplier_name || null, id]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Αποτυχία επεξεργασίας προϊόντος" });
    }
});

// 4. POST: Προσθήκη Νέου Προϊόντος
app.post('/api/products/add', async (req, res) => {
    const { name, current_stock, min_required, supplier_name } = req.body;
    try {
        const query = 'INSERT INTO products (name, current_stock, min_required, supplier_name) VALUES ($1, $2, $3, $4) RETURNING *';
        const result = await pool.query(query, [name, current_stock, min_required || 5, supplier_name || null]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Αποτυχία προσθήκης" });
    }
});

// 5. DELETE: Διαγραφή Προϊόντος
app.delete('/api/products/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        res.json({ message: "Διαγράφηκε" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Αποτυχία διαγραφής" });
    }
});

// 6. POST: Δημιουργία Παραγγελίας (Κρατάει το ΟΝΟΜΑ αυτού που παραγγέλνει)
app.post('/api/orders/create', async (req, res) => {
    const { items, ordered_by } = req.body;
    try {
        const result = await pool.query('INSERT INTO orders (items, status, ordered_by) VALUES ($1, \'ΕΚΚΡΕΜΕΙ\', $2) RETURNING *', [JSON.stringify(items), ordered_by]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Σφάλμα παραγγελίας" });
    }
});

// 7. GET: Λήψη Εκκρεμών Παραγγελιών
app.get('/api/orders/pending', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders WHERE status = \'ΕΚΚΡΕΜΕΙ\' ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Σφάλμα λήψης παραγγελιών" });
    }
});

// 8. POST: Επιβεβαίωση Παραλαβής (Δέχεται τις ΠΡΑΓΜΑΤΙΚΕΣ ποσότητες που ήρθαν)
app.post('/api/orders/receive', async (req, res) => {
    const { order_id, received_items } = req.body; // received_items: [{product_id: 1, qty_received: 15}, ...]
    try {
        await pool.query('BEGIN');
        
        for (let item of received_items) {
            await pool.query('UPDATE products SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2', [item.qty_received, item.product_id]);
            await pool.query('INSERT INTO stock_log (product_id, quantity_changed, reason, user_name) VALUES ($1, $2, \'ΠΑΡΑΛΑΒΗ ΠΑΡΑΓΓΕΛΙΑΣ\', \'Σύστημα Παραλαβής\')', [item.product_id, item.qty_received]);
        }
        
        await pool.query('UPDATE orders SET status = \'ΠΑΡΑΛΗΦΘΗΚΕ\', received_at = NOW() WHERE id = $1', [order_id]);
        await pool.query('COMMIT');
        res.json({ message: "Η αποθήκη ενημερώθηκε αυτόματα με τις ποσότητες που ήρθαν!" });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: "Σφάλμα κατά την παραλαβή" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
