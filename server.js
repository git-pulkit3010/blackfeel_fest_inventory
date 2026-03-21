require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const Razorpay = require('razorpay');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// 1. Get available variants for a design
app.get('/api/inventory/:designCode', async (req, res) => {
  const { designCode } = req.params;
  const result = await pool.query(
    'SELECT size, color, sku, quantity FROM inventory WHERE design_code = $1 AND quantity > 0',
    [designCode]
  );
  res.json(result.rows);
});

// 1.1 Get all available sizes across all designs
app.get('/api/available-sizes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT size 
      FROM inventory 
      WHERE quantity > 0 
      ORDER BY 
        CASE size
          WHEN 'XS' THEN 1
          WHEN 'S' THEN 2
          WHEN 'M' THEN 3
          WHEN 'L' THEN 4
          WHEN 'XL' THEN 5
          WHEN 'XXL' THEN 6
          ELSE 7
        END
    `);
    res.json(result.rows.map(r => r.size));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sizes' });
  }
});

// 2. Create Razorpay Order
app.post('/api/create-order', async (req, res) => {
  const { sku, amount, customer } = req.body;

  if (!sku || !amount || !customer?.name || !customer?.email || !customer?.phone || !customer?.address) {
    return res.status(400).json({ error: 'Missing required order details' });
  }

  // Final stock check
  const stock = await pool.query('SELECT quantity FROM inventory WHERE sku = $1', [sku]);
  if (stock.rows.length === 0 || stock.rows[0].quantity <= 0) {
    return res.status(400).json({ error: 'Out of stock' });
  }

  const options = {
    amount: amount * 100, // Amount in paise
    currency: "INR",
    receipt: `receipt_${sku}_${Date.now()}`,
  };

  try {
    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

function isValidRazorpaySignature(orderId, paymentId, signature) {
  const generatedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return generatedSignature === signature;
}

// 3. Verify payment and save only paid orders
app.post('/api/verify-payment', async (req, res) => {
  const { sku, amount, payment_id, order_id, payment_signature, customer } = req.body;

  if (!payment_id) {
    return res.status(400).json({ error: 'razorpay_payment_id is required' });
  }

  if (!order_id || !payment_signature) {
    return res.status(400).json({ error: 'Missing Razorpay verification details' });
  }

  if (!sku || !amount || !customer?.name || !customer?.email || !customer?.phone || !customer?.address) {
    return res.status(400).json({ error: 'Missing paid order details' });
  }

  if (!isValidRazorpaySignature(order_id, payment_id, payment_signature)) {
    return res.status(400).json({ error: 'Invalid payment signature' });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const existingOrder = await client.query(
      'SELECT 1 FROM orders WHERE razorpay_payment_id = $1 OR razorpay_order_id = $2 LIMIT 1',
      [payment_id, order_id]
    );

    if (existingOrder.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.json({ success: true, duplicate: true });
    }

    const inventoryUpdate = await client.query(
      'UPDATE inventory SET quantity = quantity - 1 WHERE sku = $1 AND quantity > 0 RETURNING quantity',
      [sku]
    );

    if (inventoryUpdate.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Item went out of stock before payment verification' });
    }

    await client.query(
      `INSERT INTO orders (
        razorpay_order_id,
        razorpay_payment_id,
        status,
        customer_name,
        customer_email,
        customer_phone,
        delivery_address,
        sku,
        amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        order_id,
        payment_id,
        'paid',
        customer.name,
        customer.email,
        customer.phone,
        customer.address,
        sku,
        amount,
      ]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError);
      }
    }
    console.error(err);
    res.status(500).json({ error: 'Database update failed' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
