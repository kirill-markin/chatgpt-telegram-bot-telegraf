import dotenv from "dotenv";
import fs from "fs";
import yaml from 'yaml';
import { Prompt } from "./types";

if (fs.existsSync(".env")) {
  dotenv.config();
}

if (typeof process.env.OPENAI_API_KEY !== 'string' || process.env.OPENAI_API_KEY === '') {
  throw new Error('OPENAI_API_KEY must be defined');
}
if (typeof process.env.DATABASE_URL !== 'string' || process.env.DATABASE_URL === '') {
  throw new Error('DATABASE_URL must be defined');
}
if (typeof process.env.TELEGRAM_BOT_TOKEN !== 'string' || process.env.TELEGRAM_BOT_TOKEN === '') {
  throw new Error('TELEGRAM_BOT_TOKEN must be defined');
}

export const DATABASE_URL : string = process.env.DATABASE_URL;
export const OPENAI_API_KEY : string = process.env.OPENAI_API_KEY;
export const TELEGRAM_BOT_TOKEN : string = process.env.TELEGRAM_BOT_TOKEN;

export const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
export const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME;

export const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY

const prompts_path = './temp/__temp_config.yaml';
const fileContents = fs.readFileSync(prompts_path, 'utf8');
const bot_settings = yaml.parse(fileContents);

export const GPT_MODEL = bot_settings?.gpt_model || 'gpt-5';
export const GPT_MODEL_FOR_IMGAGE_URL = bot_settings?.gpt_model_for_image_url || 'gpt-5';
export const maxTokensThreshold = 128000;
export const averageAnswerTokens = 8000;
export const MAX_TOKENS_THRESHOLD_TO_REDUCE_HISTORY = maxTokensThreshold - averageAnswerTokens;
export const RESET_MESSAGE = bot_settings?.strings?.reset_message || 'Old messages deleted';
export const NO_OPENAI_KEY_ERROR = bot_settings?.strings?.no_openai_key_error || 'No OpenAI key provided. Please contact the bot owner.';
export const TRIAL_ENDED_ERROR = bot_settings?.strings?.trial_ended_error || 'Trial period ended. Please contact the bot owner.';
export const TRIAL_NOT_ENABLED_ERROR = bot_settings?.strings?.trial_not_enabled_error || 'Trial period is not enabled. Please contact the bot owner.';
export const NO_VIDEO_ERROR = bot_settings?.strings?.no_video_error || 'Bot can not process videos.';
export const NO_ANSWER_ERROR = bot_settings?.strings?.no_answer_error || 'Bot can not answer to this message.';
export const MAX_TRIAL_TOKENS = process.env.MAX_TRIAL_TOKENS 
  ? parseInt(process.env.MAX_TRIAL_TOKENS) 
  : (bot_settings?.max_trials_tokens || 0);
export const HELP_MESSAGE = bot_settings?.strings?.help_string || 'This is a bot that can chat with you. You can ask it questions or just chat with it. The bot will try to respond to you as best as it can. If you want to reset the conversation, just type /reset.';
export const ERROR_MESSAGE = bot_settings?.strings?.error_string || 'An error occurred. Please try again later.';
export const botSettings = bot_settings;
export const CHAT_GPT_DEFAULT_TIMEOUT_MS = 6 * 60 * 1000;
export const defaultPrompt: Prompt | undefined = botSettings.prompts.find((prompt: Prompt) => prompt.name === 'default') || '';
export const DEFAULT_PROMPT_MESSAGE = defaultPrompt ? defaultPrompt.text : '';
