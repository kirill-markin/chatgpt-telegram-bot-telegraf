import dotenv from "dotenv";
import fs from "fs";
import { Pool, QueryResult } from 'pg';
import { MyContext, MyMessage, User, Event } from './types';
import { toLogFormat } from './utils';

if (fs.existsSync(".env")) {
  dotenv.config();
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});
export { pool }; 

const createTableQueries = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    user_id bigint UNIQUE NOT NULL,
    username VARCHAR(255),
    default_language_code VARCHAR(255),
    language_code VARCHAR(255),
    openai_api_key VARCHAR(255),
    usage_type VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    role VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    chat_id bigint NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    user_id bigint REFERENCES users(id),
    time TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    time TIMESTAMP NOT NULL,
    type VARCHAR(255) NOT NULL,
  
    user_id bigint,
    user_is_bot BOOLEAN,
    user_language_code VARCHAR(255),
    user_username VARCHAR(255),
  
    chat_id bigint,
    chat_type VARCHAR(255),
  
    message_role VARCHAR(255),
    messages_type VARCHAR(255),
    message_voice_duration INT,
    message_command VARCHAR(255),
    content_length INT,
    
    usage_model VARCHAR(255),
    usage_object VARCHAR(255),
    usage_completion_tokens INT,
    usage_prompt_tokens INT,
    usage_total_tokens INT,
    api_key VARCHAR(255)
  );
  `
];

export const usedTokensForUser = async (user_id: number): Promise<number> => {
  const res = await pool.query('SELECT SUM(usage_total_tokens) FROM events WHERE user_id = $1', [user_id]);
  return res.rows[0].sum || 0;
};

export const selectMessagesByChatIdGPTformat = async (ctx: MyContext) => {
  if (ctx.chat && ctx.chat.id) {
    const res = await pool.query(`
      SELECT role, content 
      FROM messages 
      WHERE chat_id = $1 
        AND is_active = TRUE 
        AND time >= NOW() - INTERVAL '16 hours' 
      ORDER BY id
    `, [ctx.chat.id]);
    console.log(toLogFormat(ctx, `messages received from the database: ${res.rows.length}`));
    return res.rows as MyMessage[];
  } else {
    throw new Error('ctx.chat.id is undefined');
  }
}

export const selectUserByUserId = async (user_id: number) => {
  const res = await pool.query('SELECT * FROM users WHERE user_id = $1', [user_id]);
  return res.rows[0];
}

export const insertMessage = async ({role, content, chat_id, user_id}: MyMessage) => {
  const res = await pool.query(`
    INSERT INTO messages (role, content, chat_id, time, user_id)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP, (SELECT id FROM users WHERE user_id = $4))
    RETURNING *;
  `, [role, content, chat_id, user_id]);
  return res.rows[0];
}

export const insertUserOrUpdate = async ({user_id, username, default_language_code, language_code=default_language_code, openai_api_key=null, usage_type}: User) => {
  try {
    const res = await pool.query(`
    INSERT INTO users (user_id, username, default_language_code, language_code, openai_api_key, usage_type, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id) DO UPDATE SET
      username = EXCLUDED.username,
      default_language_code = EXCLUDED.default_language_code,
      language_code = EXCLUDED.language_code,
      openai_api_key = EXCLUDED.openai_api_key,
      usage_type = EXCLUDED.usage_type,
      created_at = COALESCE(users.created_at, EXCLUDED.created_at)
    RETURNING *;
  `, [user_id, username, default_language_code, language_code, openai_api_key, usage_type]);
  return res.rows[0];
  } catch (error) {
    throw error;
  }
}
  
export const insertEvent = async (event: Event) => {
  event.time = new Date();
  try {
    const res = await pool.query(`
      INSERT INTO events (
        time,
        type,
  
        user_id,
        user_is_bot,
        user_language_code,
        user_username,
  
        chat_id,
        chat_type,
  
        message_role,
        messages_type,
        message_voice_duration,
        message_command,
        content_length,
  
        usage_model,
        usage_object,
        usage_completion_tokens,
        usage_prompt_tokens,
        usage_total_tokens,
        api_key
      )
      VALUES (
        $1, $2,
        $3, $4, $5, $6,
        $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19
      )
      RETURNING *;
    `, [
      event.time,
      event.type,
  
      event.user_id,
      event.user_is_bot,
      event.user_language_code,
      event.user_username,
  
      event.chat_id,
      event.chat_type,
  
      event.message_role,
      event.messages_type,
      event.message_voice_duration,
      event.message_command,
      event.content_length,
  
      event.usage_model,
      event.usage_object,
      event.usage_completion_tokens,
      event.usage_prompt_tokens,
      event.usage_total_tokens,
      event.api_key,
    ]);
    return res.rows[0];
  } catch (error) {
    throw error;
  }
}

export const deleteMessagesByChatId = async (chat_id: number) => {
  const res = await pool.query('DELETE FROM messages WHERE chat_id = $1', [chat_id]);
  return res;
}

export const deactivateMessagesByChatId = async (chat_id: number) => {
  const res = await pool.query('UPDATE messages SET is_active = FALSE WHERE chat_id = $1', [chat_id]);
  return res;
}