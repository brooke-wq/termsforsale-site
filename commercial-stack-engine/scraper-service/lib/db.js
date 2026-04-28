'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT) || 5433,
  database: process.env.POSTGRES_DB || 'stack_engine',
  user: process.env.POSTGRES_USER || 'cse',
  password: process.env.POSTGRES_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30_000
});

async function withClient(fn) {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

module.exports = { pool, withClient };
