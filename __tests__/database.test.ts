import { Pool } from 'pg';
import dotenv from 'dotenv';

// Mock the pg module
jest.mock('pg');

// Load environment variables from .env file
dotenv.config();

const pool = new Pool();

describe('Database Tests', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('should fetch users from the database', async () => {
    const res = await pool.query('SELECT * FROM users');
    expect(res.rows.length).toBeGreaterThan(0);
  });

  // Add more tests here
});