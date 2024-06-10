import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

describe('Database Tests', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('should fetch users from the database', async () => {
    try {
      const res = await pool.query('SELECT * FROM users');
      expect(res.rows.length).toBeGreaterThan(0);
    } catch (error) {
      console.error('Database connection error:', error);
      throw error;
    }
  });

  // Add more tests here
});