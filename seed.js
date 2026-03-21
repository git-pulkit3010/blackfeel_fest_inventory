require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const csv = require('csv-parser');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

async function seed() {
  const results = [];
  
  // Mapping designs based on your file [cite: 1, 2]
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
}

seed();