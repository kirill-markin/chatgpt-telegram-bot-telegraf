import { Context } from "telegraf";
import OpenAI from 'openai';


interface SessionData {
  messageCount: number;
}

export interface MyContext extends Context {
  botUsername?: string;
  session?: SessionData;
}

export interface MyMessageContent {
  type?: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface MyMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | MyMessageContent[];
  chat_id: number | null;
  user_id: number | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface Prompt {
  name: string;
  text: string;
}

export interface User {
  user_id: number;
  username: string;
  default_language_code: string;
  language_code?: string | null;
  openai_api_key?: string | null;
  usage_type?: string | null;
}

export interface Event {
  time: Date;
  type: string;

  user_id?: number | null;
  user_is_bot?: boolean | null;
  user_language_code?: string | null;
  user_username?: string | null;

  chat_id?: number | null;
  chat_type?: string | null;

  message_role?: string | null;
  messages_type?: string | null;
  message_voice_duration?: number | null;
  message_command?: string | null;
  content_length?: number | null;

  usage_model?: string | null;
  usage_object?: string | null;
  usage_completion_tokens?: number | null;
  usage_prompt_tokens?: number | null;
  usage_total_tokens?: number | null;
  api_key?: string | null;
}

export interface UserSettings {
  user_id: number;
  username: string | null;
  default_language_code: string | null;
  language_code: string | null;
  openai_api_key?: string;
  usage_type?: string;
}

export interface UserData {
  settings: UserSettings;
  openai: OpenAI | null;
}
export class NoOpenAiApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoOpenAiApiKeyError';
  }
}
