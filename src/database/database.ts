import { Pool } from 'pg';
import { MyContext, MyMessage, MyMessageContent, User, Event, UserData } from '../types';
import { formatLogMessage } from '../utils/utils';
import { DATABASE_URL, NO_ANSWER_ERROR } from '../config';

if (typeof DATABASE_URL !== 'string') {
  throw new Error('DATABASE_URL is not defined');
}
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});
export { pool }; 

export const getUserUsedTokens = async (user_id: number): Promise<number> => {
  const res = await pool.query('SELECT SUM(usage_total_tokens) FROM events WHERE user_id = $1', [user_id]);
  return res.rows[0].sum || 0;
};

const getMessagesByChatId = async (ctx: MyContext): Promise<MyMessage[]> => {
  if (ctx.chat && ctx.chat.id) {
    const res = await pool.query(`
      SELECT role, content 
      FROM messages 
      WHERE chat_id = $1 
        AND is_active = TRUE 
        AND time >= NOW() - INTERVAL '16 hours' 
      ORDER BY id
    `, [ctx.chat.id]);
    console.log(formatLogMessage(ctx, `messages received from the database: ${res.rows.length}`));
    return res.rows as MyMessage[];
  } else {
    throw new Error('ctx.chat.id is undefined');
  }
}

const convertMessages = (messages: MyMessage[]): MyMessage[] => {
  return messages.map(message => {
    let newContent: MyMessageContent[] = [];

    if (typeof message.content === 'string') {
      if (message.content.startsWith('data:')) {
        // Assuming it is an image URL
        newContent.push({
          type: 'image_url',
          image_url: {
            url: message.content
          }
        });
      } else {
        // Assuming it is text
        newContent.push({
          type: 'text',
          text: message.content
        });
      }  
    } else {
      throw new Error('message.content is not a string after the query from the database');
    }

    return {
      ...message,
      content: newContent
    };
  });
}

export const getAndConvertMessagesByChatId = async (ctx: MyContext): Promise<MyMessage[]> => {
  const messages = await getMessagesByChatId(ctx);
  return convertMessages(messages);
}

export const getUserByUserId = async (user_id: number) => {
  const res = await pool.query('SELECT * FROM users WHERE user_id = $1', [user_id]);
  return res.rows[0];
}

export const addMessage = async ({role, content, chat_id, user_id}: MyMessage) => {
  const res = await pool.query(`
    INSERT INTO messages (role, content, chat_id, time, user_id)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP, (SELECT id FROM users WHERE user_id = $4))
    RETURNING *;
  `, [role, content, chat_id, user_id]);
  return res.rows[0];
}

export const upsertUserIfNotExists = async ({user_id, username, default_language_code, language_code=default_language_code, openai_api_key=null, usage_type=null}: User) => {
  try {
    const res = await pool.query(`
    INSERT INTO users (user_id, username, default_language_code, language_code, openai_api_key, usage_type, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id) DO UPDATE SET
      username = EXCLUDED.username,
      default_language_code = EXCLUDED.default_language_code,
      language_code = EXCLUDED.language_code,
      openai_api_key = COALESCE(EXCLUDED.openai_api_key, users.openai_api_key),
      usage_type = COALESCE(EXCLUDED.usage_type, users.usage_type),
      created_at = COALESCE(users.created_at, EXCLUDED.created_at)
    RETURNING *;
  `, [user_id, username, default_language_code, language_code, openai_api_key, usage_type]);
  return res.rows[0];
  } catch (error) {
    throw error;
  }
}

export const updateUserForce = async ({user_id, username, default_language_code, language_code=default_language_code, openai_api_key=null, usage_type=null}: User) => {
  try {
    const res = await pool.query(`
    UPDATE users SET
      username = $2,
      default_language_code = $3,
      language_code = $4,
      openai_api_key = $5,
      usage_type = $6,
      created_at = CURRENT_TIMESTAMP
    WHERE user_id = $1
    RETURNING *;
  `, [user_id, username, default_language_code, language_code, openai_api_key, usage_type]);
    return res.rows[0];
  } catch (error) {
    throw error;
  }
}
  
export const addEvent = async (event: Event) => {
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

export const removeMessagesByChatId = async (chat_id: number) => {
  const res = await pool.query('DELETE FROM messages WHERE chat_id = $1', [chat_id]);
  return res;
}

export const disableMessagesByChatId = async (chat_id: number) => {
  const res = await pool.query('UPDATE messages SET is_active = FALSE WHERE chat_id = $1', [chat_id]);
  return res;
}

export async function storeAnswer(chatResponse: any, ctx: MyContext, userData: UserData) {
  try {
    if (!userData.openai) {
      throw new Error('openai is not defined in userData');
    }
    const answer = chatResponse.choices?.[0]?.message?.content || NO_ANSWER_ERROR;
    if (ctx.chat && ctx.chat.id) {
      addMessage({
        role: "assistant",
        content: answer,
        chat_id: ctx.chat.id,
        user_id: null,
      });
    } else {
      throw new Error(`ctx.chat.id is undefined`);
    }
    addEvent({
      type: 'assistant_message',
      user_id: ctx.from?.id || null,
      user_is_bot: ctx.from?.is_bot || null,
      user_language_code: ctx.from?.language_code || null,
      user_username: ctx.from?.username || null,
      chat_id: ctx.chat?.id || null,
      chat_type: ctx.chat?.type || null,
      message_role: "assistant",
      messages_type: "text",
      message_voice_duration: null,
      message_command: null,
      content_length: answer.length,
      usage_model: chatResponse.model || null,
      usage_object: chatResponse.object || null,
      usage_completion_tokens: chatResponse.usage?.completion_tokens || null,
      usage_prompt_tokens: chatResponse.usage?.prompt_tokens || null,
      usage_total_tokens: chatResponse.usage?.total_tokens || null,
      api_key: userData.openai.apiKey || null,
    } as Event);
    console.log(formatLogMessage(ctx, `answer saved to the database. total_tokens for this answer: ${chatResponse.usage?.total_tokens || null}`));
  } catch (error) {
    console.error(formatLogMessage(ctx, `[ERROR] error in saving the answer to the database: ${error}`));
  }
}

export async function storeCommand(ctx: MyContext, command: string) {
  try {
    addEvent({
      type: 'user_command',
      user_id: ctx.from?.id || null,
      user_is_bot: ctx.from?.is_bot || null,
      user_language_code: ctx.from?.language_code || null,
      user_username: ctx.from?.username || null,
      chat_id: ctx.chat?.id || null,
      chat_type: ctx.chat?.type || null,
      message_role: "user",
      messages_type: "text",
      message_voice_duration: null,
      message_command: command,
      content_length: null,
      usage_model: null,
      usage_object: null,
      usage_completion_tokens: null,
      usage_prompt_tokens: null,
      usage_total_tokens: null,
      api_key: null,
    } as Event);
    console.log(formatLogMessage(ctx, `${command} saved to the database`));
  } catch (error) {
    console.error(formatLogMessage(ctx, `[ERROR] error in saving the command to the database: ${error}`));
  }
}

// addEvent Simple with only type, message_role, messages_type and this is it
export async function addSimpleEvent(ctx: MyContext, type: string, message_role: string, messages_type: string) {
  try {
    addEvent({
      type: type,
      user_id: ctx.from?.id || null,
      user_is_bot: ctx.from?.is_bot || null,
      user_language_code: ctx.from?.language_code || null,
      user_username: ctx.from?.username || null,
      chat_id: ctx.chat?.id || null,
      chat_type: ctx.chat?.type || null,
      message_role: message_role,
      messages_type: messages_type,
      message_voice_duration: null,
      message_command: null,
      content_length: null,
      usage_model: null,
      usage_object: null,
      usage_completion_tokens: null,
      usage_prompt_tokens: null,
      usage_total_tokens: null,
      api_key: null,
    } as Event);
    console.log(formatLogMessage(ctx, `${message_role} saved to the database`));
  } catch (error) {
    console.error(formatLogMessage(ctx, `[ERROR] error in saving the ${message_role} to the database: ${error}`));
  }
}

export async function addEventByMessageType(ctx: MyContext, eventType: string, messageType: string, messageContent: string) {
  try {
    addEvent({
      type: eventType,
      user_id: ctx.from?.id || null,
      user_is_bot: ctx.from?.is_bot || null,
      user_language_code: ctx.from?.language_code || null,
      user_username: ctx.from?.username || null,
      chat_id: ctx.chat?.id || null,
      chat_type: ctx.chat?.type || null,
      message_role: "user",
      messages_type: messageType,
      // @ts-ignore
      message_voice_duration: messageType === "voice" ? ctx.message?.voice?.duration : null,
      message_command: null,
      content_length: messageContent.length,
      usage_model: null,
      usage_object: null,
      usage_completion_tokens: null,
      usage_prompt_tokens: null,
      usage_total_tokens: null,
      api_key: null,
    } as Event);
    console.log(formatLogMessage(ctx, `${messageType} saved to the database`));
  } catch (error) {
    console.error(formatLogMessage(ctx, `[ERROR] error in saving the ${messageType} to the database: ${error}`));
  }
}

export async function addTranscriptionEvent(ctx: MyContext, transcriptionText: string, userData: UserData) {
  try {
    if (!userData.openai) {
      throw new Error('openai is not defined in userData');
    }
    addEvent({
      type: 'model_transcription',

      user_id: ctx.from?.id || null,
      user_is_bot: ctx.from?.is_bot || null,
      user_language_code: ctx.from?.language_code || null,
      user_username: ctx.from?.username || null,

      chat_id: ctx.chat?.id || null,
      chat_type: ctx.chat?.type || null,

      message_role: null,
      messages_type: null,
      message_voice_duration: null,
      message_command: null,
      content_length: transcriptionText.length,

      usage_model: "whisper-1",
      usage_object: null,
      usage_completion_tokens: null,
      usage_prompt_tokens: null,
      usage_total_tokens: null,
      api_key: userData.openai.apiKey || null,
    } as Event);
    console.log(formatLogMessage(ctx, `model_transcription saved to the database`));
  } catch (error) {
    console.error(formatLogMessage(ctx, `[ERROR] error in saving the model_transcription to the database: ${error}`));
  }
}

export const getAllPremiumUsers = async () => {
  const res = await pool.query(`
    SELECT user_id, username, created_at 
    FROM users 
    WHERE usage_type = $1 
    ORDER BY created_at DESC NULLS LAST
  `, ['premium']);
  return res.rows;
};

export const addMessagesBatch = async (messages: MyMessage[]) => {
  const query = `
    INSERT INTO messages (role, content, chat_id, time, user_id)
    VALUES ${messages.map((_, i) => `($${4 * i + 1}, $${4 * i + 2}, $${4 * i + 3}, CURRENT_TIMESTAMP, (SELECT id FROM users WHERE user_id = $${4 * i + 4}))`).join(',')}
    RETURNING *;
  `;

  const values = messages.flatMap(({ role, content, chat_id, user_id }) => {
    if (typeof content !== 'string') {
      throw new Error('Content must be a string');
    }
    return [role, content, chat_id, user_id];
  });

  try {
    const res = await pool.query(query, values);
    return res.rows;
  } catch (error) {
    throw error;
  }
}
