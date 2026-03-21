require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const csv = require('csv-parser');

const pool = new Pool({
  connectionString: process.env.DB_URL_RENDER,
  ssl: {
    rejectUnauthorized: false
  }
});
async function seed() {
  try {
    // Create Tables if they don't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inventory (
        sku TEXT PRIMARY KEY,
        size TEXT,
        color TEXT,
        design_code TEXT,
        design_name TEXT,
        quantity INTEGER DEFAULT 0
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT UNIQUE,
        status TEXT,
        customer_name TEXT,
        customer_email TEXT,
        customer_phone TEXT,
        delivery_address TEXT,
        sku TEXT,
        amount NUMERIC,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Tables verified/created successfully');

    const results = [];
    // Mapping designs based on your file
    const designMap = {
      'D1': 'Travis',
      'D2': 'Paradise',
      'D3': 'Karan Aujla',
      'D4': 'Better Call Saul',
      'D5': 'Company Logo'
    };

    fs.createReadStream('Fest_SKUs.csv')
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        for (const row of results) {
          if (!row.SKU) continue;
          const query = `
            INSERT INTO inventory (size, color, design_code, design_name, sku, quantity)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (sku) DO UPDATE SET quantity = $6;
          `;
          const values = [
            row.Size, 
            row.Color, 
            row.Design, 
            designMap[row.Design], 
            row.SKU, 
            parseInt(row.Quantity) || 0
          ];
          await pool.query(query, values);
        }
        console.log('Database Seeded Successfully');
        process.exit();
      });
  } catch (err) {
    console.error('Error seeding database:', err);
    process.exit(1);
  }
}

seed();