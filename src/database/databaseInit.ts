import { pool } from './database';

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
  `,
  `
  CREATE OR REPLACE FUNCTION delete_old_messages() RETURNS trigger AS $$
  BEGIN
    DELETE FROM messages WHERE time < NOW() - INTERVAL '7 days';
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  `,
  `
  DROP TRIGGER IF EXISTS trigger_delete_old_messages ON messages;
  `,
  `
  CREATE TRIGGER trigger_delete_old_messages
  AFTER INSERT OR UPDATE ON messages
  EXECUTE FUNCTION delete_old_messages();
  `,
];

function isError(err: unknown): err is Error {
  return err instanceof Error;
}

export const setupDatabase = async () => {
  try {
    for (const createTableQuery of createTableQueries) {
      await pool.query(createTableQuery);
    }
    console.log('Related tables checked/created successfully');
  } catch (err) {
    if (isError(err)) {
      console.error('Error with checking/creating tables', err.stack);
    } else {
      console.error('Unexpected error with checking/creating tables', err);
    }
    throw err;
  }
};
