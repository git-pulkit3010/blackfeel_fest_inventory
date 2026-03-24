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
  connectionString: process.env.DB_URL_RENDER,
  ssl: { rejectUnauthorized: false }
});

pool.query('SELECT NOW()')
  .then(res => console.log('DB connected:', res.rows[0]))
  .catch(err => console.error('DB connection error:', err));

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client', err.stack);
  }
  console.log('Successfully connected to PostgreSQL');
  release();
});

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// Simple in-memory store for OTPs (Note: For a large scale production app, use Redis or Postgres for this)
const otpStore = new Map();

// Helper to generate a 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

app.use(express.static('public'));

// Send OTP
app.post('/api/send-otp', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const otp = generateOTP();
  // Store OTP with a 10-minute expiration
  otpStore.set(email, { otp, expiresAt: Date.now() + 10 * 60 * 1000 });

  try {
    await resend.emails.send({
      from: 'BlackWeave <verify@drop.blackfeel.co.in>', // Update with your verified Resend domain
      to: email,
      subject: 'BlackWeave - Verify your email',
      html: `
        <div style="font-family: sans-serif; color: #111317;">
            <h2>Hi ${name},</h2>
            <p>Your verification code for checkout is: <strong style="font-size: 24px;">${otp}</strong></p>
            <p>This code will expire in 10 minutes.</p>
        </div>
      `
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Resend OTP Error:', error);
    res.status(500).json({ error: 'Failed to send OTP email' });
  }
});

// Verify OTP
app.post('/api/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  const storedData = otpStore.get(email);

  if (!storedData || storedData.otp !== otp || Date.now() > storedData.expiresAt) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  // OTP is valid, remove it from memory so it can't be reused
  otpStore.delete(email);
  res.json({ success: true });
});

// 1. Get available variants for a design
app.get('/api/inventory/:designCode', async (req, res) => {
  const { designCode } = req.params;
  try {
    const result = await pool.query(
      'SELECT size, color, sku, quantity FROM inventory WHERE design_code = $1 AND quantity > 0',
      [designCode]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Inventory Fetch Error:', err);
    res.status(500).json({ error: 'Database query failed', details: err.message });
  }
});

// 1.1 Get all available sizes across all designs
// Get all available sizes (Fixed PostgreSQL DISTINCT error)
app.get('/api/available-sizes', async (req, res) => {
  try {
    // 1. Just get the unique sizes, no SQL ORDER BY
    const result = await pool.query('SELECT DISTINCT size FROM inventory');
    
    // 2. Extract the sizes into a flat array: ['S', 'M', 'L', 'XL']
    let sizes = result.rows.map(row => row.size);

    // 3. Sort them logically in JavaScript instead of SQL
    const sizeOrder = { 'S': 1, 'M': 2, 'L': 3, 'XL': 4, 'XXL': 5 };
    sizes.sort((a, b) => (sizeOrder[a] || 99) - (sizeOrder[b] || 99));

    res.json(sizes);
  } catch (err) {
    console.error("Available Sizes Fetch Error:", err);
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

    // --- NEW: Send Confirmation Email ---
    try {
      await resend.emails.send({
        from: 'BlackWeave <orders@yourdomain.com>', // Update with your verified Resend domain
        to: customer.email,
        subject: 'Order Confirmed - BlackWeave',
        html: `
          <div style="font-family: sans-serif; color: #111317;">
              <h1>Thank you for your order, ${customer.name}!</h1>
              <p>Your order for <strong>${sku}</strong> has been successfully placed.</p>
              <p><strong>Amount Paid:</strong> ₹${amount}</p>
              <p><strong>Delivery Address:</strong><br/>${customer.address}</p>
              <p>We will notify you once your item ships.</p>
          </div>
        `
      });
    } catch (emailErr) {
      // We don't want to fail the checkout if the email fails, just log it
      console.error("Order confirmation email failed to send:", emailErr);
    }
    // ------------------------------------

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

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(process.env.PORT || 3000, () => console.log('Server running on port 3000'));