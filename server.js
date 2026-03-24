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
  const { sku, amount, payment_id, order_id, payment_signature, customer, designName, color, productImage } = req.body;

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
      // Build the full image URL (images are stored in public/mockups/)
      const imageUrl = productImage ? `https://blackfeel.co.in/${productImage}` : 'https://blackfeel.co.in/mockups/D1MockupBlack.jpeg';
      
      await resend.emails.send({
        from: 'BlackWeave <confirmation@drop.blackfeel.co.in>',
        to: customer.email,
        subject: 'Order Confirmed - BlackWeave',
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
                .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #111317 0%, #1e2024 100%); padding: 40px 30px; text-align: center; }
                .header h1 { color: #e9c176; margin: 0; font-size: 28px; font-weight: 300; letter-spacing: 4px; text-transform: uppercase; }
                .product-image { width: 100%; height: 400px; object-fit: cover; display: block; }
                .content { padding: 40px 30px; }
                .greeting { font-size: 22px; color: #111317; margin-bottom: 20px; font-weight: 600; }
                .thank-you { font-size: 16px; color: #666; line-height: 1.6; margin-bottom: 30px; }
                .order-details { background-color: #f9f9f9; border-left: 4px solid #e9c176; padding: 25px; margin: 30px 0; }
                .order-details h2 { color: #111317; font-size: 18px; margin: 0 0 20px 0; text-transform: uppercase; letter-spacing: 2px; }
                .detail-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; }
                .detail-label { color: #666; font-weight: 500; }
                .detail-value { color: #111317; font-weight: 600; }
                .address-section { margin: 25px 0; padding: 20px; background-color: #fafafa; border-radius: 4px; }
                .address-section h3 { color: #111317; font-size: 14px; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 1px; }
                .address-section p { color: #666; line-height: 1.8; margin: 0; font-size: 14px; }
                .footer { background-color: #f5f5f5; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0; }
                .footer p { color: #999; font-size: 12px; line-height: 1.6; margin: 8px 0; }
                .footer .contact { color: #e9c176; font-weight: 600; text-decoration: none; }
                .divider { height: 1px; background-color: #e0e0e0; margin: 25px 0; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>BlackWeave</h1>
                </div>
                
                <img src="${imageUrl}" alt="${designName}" class="product-image">
                
                <div class="content">
                  <div class="greeting">Thank you for your order, ${customer.name.split(' ')[0]}!</div>
                  
                  <div class="thank-you">
                    Your order has been successfully placed and confirmed. We're thrilled to bring you this premium piece from our Fest Collection. Our team will carefully prepare your order and notify you once it ships.
                  </div>
                  
                  <div class="order-details">
                    <h2>Order Details</h2>
                    <div class="detail-row">
                      <span class="detail-label">Design</span>
                      <span class="detail-value">${designName || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">Color</span>
                      <span class="detail-value">${color || 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">Size</span>
                      <span class="detail-value">${sku ? sku.split('-')[1] : 'N/A'}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">SKU</span>
                      <span class="detail-value">${sku || 'N/A'}</span>
                    </div>
                    <div class="divider"></div>
                    <div class="detail-row">
                      <span class="detail-label">Amount Paid</span>
                      <span class="detail-value">₹${amount}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">Payment ID</span>
                      <span class="detail-value" style="font-size: 12px;">${payment_id}</span>
                    </div>
                  </div>
                  
                  <div class="address-section">
                    <h3>Delivery Address</h3>
                    <p>
                      <strong>${customer.name}</strong><br>
                      ${customer.phone}<br>
                      ${customer.address}
                    </p>
                  </div>
                  
                  <div class="thank-you" style="margin-top: 30px; font-style: italic; color: #888;">
                    "Exploring the intersection of premium textile and design genius."
                  </div>
                </div>
                
                <div class="footer">
                  <p><strong>BLACKWEAVE</strong> | Fest Collection</p>
                  <p>Questions? Reach us at <a href="mailto:corporat@blackfeel.co.in" class="contact">corporat@blackfeel.co.in</a></p>
                  <p style="margin-top: 20px; font-size: 11px;">© 2025 BlackFeel Pvt Ltd. All rights reserved.</p>
                </div>
              </div>
            </body>
          </html>
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