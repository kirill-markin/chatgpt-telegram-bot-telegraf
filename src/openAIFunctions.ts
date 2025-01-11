import OpenAI from 'openai';
import { MyContext, MyMessage, MyMessageContent, UserData } from './types';
import { AxiosResponse } from 'axios';
import pTimeout from 'p-timeout';
import { formatLogMessage } from './utils/utils';
import { tokenizeText, convertTokensToText } from './utils/encodingUtils';
import { 
  CHAT_GPT_DEFAULT_TIMEOUT_MS, 
  GPT_MODEL, 
  GPT_MODEL_FOR_IMGAGE_URL,
  MAX_TOKENS_THRESHOLD_TO_REDUCE_HISTORY, 
  DEFAULT_PROMPT_MESSAGE,
  PERPLEXITY_API_KEY
} from './config';
import { getUserUsedTokens, upsertUserIfNotExists, getUserByUserId } from './database/database';
import { MAX_TRIAL_TOKENS, OPENAI_API_KEY } from './config';
import { truncateMessages } from "./utils/messageUtils";
import { createPerplexityTool, callPerplexity } from './tools/perplexityTool';
import { reply } from './utils/responseUtils';

export const APPROX_IMAGE_TOKENS = 800;

// default prompt message to add to the GPT model

let defaultPromptMessageObj = {} as MyMessage;
const defaultPromptMessageString = DEFAULT_PROMPT_MESSAGE?.toString() + "\n\nCurrent date (UTC): " + new Date().toLocaleDateString();
if (DEFAULT_PROMPT_MESSAGE) {
  defaultPromptMessageObj = {
    "role": "system",
    "content": defaultPromptMessageString
  } as MyMessage;
} else {
  console.log('Default prompt message not found');
}

// OpenAI functions

export async function getUserSettingsAndOpenAi(ctx: MyContext): Promise<UserData> {
  try {
    if (ctx.from && ctx.from.id) {
      const user_id = ctx.from.id;
      let userSettings = await getUserByUserId(user_id);
      if (!userSettings) {
        // If the user is not found, create new settings
        userSettings = {
          user_id: user_id,
          username: ctx.from?.username || null,
          default_language_code: ctx.from?.language_code || null,
          language_code: ctx.from?.language_code || null,
        };
        await upsertUserIfNotExists(userSettings); // Insert the new user
        console.log(formatLogMessage(ctx, "User created in the database"));
      } else {
        // If the user is found, update their data
        userSettings.username = ctx.from?.username || userSettings.username;
        userSettings.default_language_code = ctx.from?.language_code || userSettings.default_language_code;
        userSettings.language_code = ctx.from?.language_code || userSettings.language_code;
        await upsertUserIfNotExists(userSettings); // Update the user's data
        console.log(formatLogMessage(ctx, "User data updated in the database"));
      }

      // Check if user has openai_api_key or is premium
      if (userSettings.openai_api_key) { // custom api key
        console.log(formatLogMessage(ctx, `[ACCESS GRANTED] user has custom openai_api_key.`));
      } else if (userSettings.usage_type === 'premium') { // premium user
        userSettings.openai_api_key = OPENAI_API_KEY;
        console.log(formatLogMessage(ctx, `[ACCESS GRANTED] user is premium but has no custom openai_api_key. openai_api_key set from environment variable.`));
      } else { // no access or trial
        const usedTokens = await getUserUsedTokens(user_id);
        if (usedTokens < MAX_TRIAL_TOKENS) {
          userSettings.usage_type = 'trial_active';
          await upsertUserIfNotExists(userSettings);
          userSettings.openai_api_key = OPENAI_API_KEY;
          console.log(formatLogMessage(ctx, `[ACCESS GRANTED] user is trial and user did not exceed the message limit. User used tokens: ${usedTokens} out of ${MAX_TRIAL_TOKENS}. openai_api_key set from environment variable.`));
        } else {
          userSettings.usage_type = 'trial_ended';
          await upsertUserIfNotExists(userSettings);
          console.warn(formatLogMessage(ctx, `[WARN][ACCESS DENIED] user is not premium and has no custom openai_api_key and exceeded the message limit. User used tokens: ${usedTokens} out of ${MAX_TRIAL_TOKENS}.`));
          userSettings.openai_api_key = null;
        }
      }

      let openai = null;
      if (userSettings.openai_api_key !== null) {
        openai = new OpenAI({
          apiKey: userSettings.openai_api_key,
        });
      }
      
      return {settings: userSettings, openai: openai}
    } else {
      throw new Error('ctx.from.id is undefined');
    }
  } catch (error) {
    throw error;
  }
}

async function createChatCompletionWithRetries(
  messages: MyMessage[],
  openai: OpenAI,
  ctx: MyContext,
  retries = 5,
  timeoutMs = CHAT_GPT_DEFAULT_TIMEOUT_MS,
  toolRetries = 3
) {
  let model = GPT_MODEL;
  if (messages.some(message => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'))) {
    model = GPT_MODEL_FOR_IMGAGE_URL;
  }
  
  // Create tools array only if Perplexity API key is available
  let tools;
  if (PERPLEXITY_API_KEY) {
    const perplexityTool = {
      type: 'function' as const,
      function: {
        name: 'perplexity',
        description: 'Search the internet for current information',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query'
            }
          },
          required: ['query']
        }
      }
    };
    tools = [perplexityTool];
  }

  // Add no-tools message if tools array is empty
  if (!tools) {
    messages.unshift({
      role: "system",
      content: "You have no access to external tools or the internet. Please respond using only your built-in knowledge.",
      chat_id: ctx.chat?.id ?? null,
      user_id: ctx.from?.id ?? null
    });
  }

  for (let i = 0; i < retries; i++) {
    try {
      const filteredMessages = messages.filter(msg => msg.role !== 'tool' || (msg.role === 'tool' && 'tool_call_id' in msg));

      type OpenAIMessage = {
        role: 'system' | 'user' | 'assistant' | 'tool';
        content: string;
        tool_call_id?: string;
        tool_calls?: any[];
      };

      const formattedMessages = filteredMessages.map(msg => ({
        role: msg.role,
        content: Array.isArray(msg.content) 
          ? msg.content
          : msg.content,
        ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id }),
        ...(msg.tool_calls && { tool_calls: msg.tool_calls })
      })) as OpenAI.Chat.ChatCompletionMessageParam[];

      const completion = await pTimeout(
        openai.chat.completions.create({
          model: model,
          messages: formattedMessages,
          stream: false,
          ...(tools && { tools: tools }),
          ...(tools && { tool_choice: 'auto' }),
        }) as Promise<OpenAI.Chat.ChatCompletion>,
        timeoutMs,
      );

      // Handle tool calls
      if (completion.choices[0]?.message?.tool_calls && toolRetries > 0) {
        const toolCalls = completion.choices[0].message.tool_calls;
        console.log('Tool calls detected:', toolCalls.length);
        
        // Отправляем сообщение пользователю о поиске информации
        reply(ctx, "🔍🌐 searching via Perplexity... One moment please...", "perplexity search notification", "warn");

        try {
          // Process all tool calls and create corresponding tool messages
          const toolMessages = await Promise.all(
            toolCalls.map(async (toolCall: OpenAI.Chat.ChatCompletionMessageToolCall) => {
              if (toolCall.function.name === 'perplexity') {
                console.log('Processing Perplexity tool call');
                try {
                  const args = JSON.parse(toolCall.function.arguments);
                  const result = await callPerplexity(args.query);

                  // Append sources to the answer if they exist
                  if (result.sources && result.sources.length > 0) {
                    result.answer += `\n\nSources:\n${result.sources.join('\n')}`;
                  }

                  console.log('Perplexity tool call successful');
                  return {
                    role: 'tool',
                    content: JSON.stringify(result),
                    tool_call_id: toolCall.id, // Important: match the specific tool_call_id
                  };
                } catch (error) {
                  console.error('Perplexity tool call failed:', error);
                  return {
                    role: 'tool',
                    content: JSON.stringify({
                      answer: "Sorry, I couldn't get additional information from Perplexity. I'll try to answer based on my existing knowledge.",
                      error: error instanceof Error ? error.message : 'Unknown error',
                      timestamp: new Date().toISOString()
                    }),
                    tool_call_id: toolCall.id,
                  };
                }
              }
              return null;
            })
          );

          console.log('All tool results processed');

          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: completion.choices[0].message.content ?? '',
            tool_calls: toolCalls,
            chat_id: ctx.chat?.id ?? null,
            user_id: ctx.from?.id ?? null
          });

          // Add all tool response messages
          messages.push(...toolMessages
            .filter(msg => msg !== null)
            .map(msg => ({
              ...msg,
              role: msg.role as "tool" | "assistant" | "system" | "user",
              chat_id: ctx.chat?.id ?? null,
              user_id: ctx.from?.id ?? null
            }))
          );

          // Make another call with decremented toolRetries
          return await createChatCompletionWithRetries(
            messages,
            openai,
            ctx,
            retries - 1,
            timeoutMs,
            toolRetries - 1
          );
        } catch (toolError) {
          console.error(`Error processing tool calls: ${toolError}`);
          // Retry the chat completion if tool call fails
          if (i < retries - 1) {
            console.log(`Retrying chat completion after tool call failure. Retries left: ${retries - i - 1}`);
            continue;
          }
          // If this was the last retry, return the completion without tool results
          return completion;
        }
      }

      return completion;
    } catch (error) {
      if (error instanceof pTimeout.TimeoutError) {
        console.error(`openai.createChatCompletion timed out. Retries left: ${retries - i - 1}`);
      } else if (error instanceof OpenAI.APIError) {
        console.error(`openai.createChatCompletion failed. Retries left: ${retries - i - 1}`);
        console.error(error.status);
        console.error(error.message);
        console.error(error.code);
        console.error(error.type);
      } else {
        console.error(error);
      }
      
      if (i === retries - 1) throw error;
    }
  }
}

export function truncateHistoryToTokenLimit(
  ctx: MyContext,
  messages: MyMessage[],
  maxTokens: number,
): MyMessage[] {
  let initialTokenCount = 0;
  let resultTokenCount = 0;
  
  // Count the initial number of tokens
  messages.forEach(message => {
    if (Array.isArray(message.content)) {
      message.content.forEach(part => {
        if (part.type === 'text') {
          const tokens = tokenizeText(part.text!);
          initialTokenCount += tokens.length;
        } else if (part.type === 'image_url') {
          initialTokenCount += APPROX_IMAGE_TOKENS;
        }
      });
    } else {
      const tokens = tokenizeText(message.content);
      initialTokenCount += tokens.length;
    }
  });

  const messagesCleaned = messages.reduceRight<MyMessage[]>((acc, message) => {
    let messageTokenCount = 0;
    if (Array.isArray(message.content)) {
      let newContent: MyMessageContent[] = [];

      for (let i = message.content.length - 1; i >= 0; i--) {
        const part = message.content[i];
        if (part.type === 'text') {
          const tokens = tokenizeText(part.text!);
          messageTokenCount += tokens.length;

          if (resultTokenCount + messageTokenCount <= maxTokens) {
            newContent.unshift(part);
            resultTokenCount += tokens.length;
          } else {
            const tokensAvailable = maxTokens - resultTokenCount;
            if (tokensAvailable > 0) {
              const partialTokens = tokens.slice(0, tokensAvailable);
              const partialContent = convertTokensToText(partialTokens);
              newContent.unshift({ ...part, text: partialContent });
              resultTokenCount += tokensAvailable;
            }
            break;
          }
        } else if (part.type === 'image_url') {
          const imageTokenCount = APPROX_IMAGE_TOKENS;
          if (resultTokenCount + imageTokenCount <= maxTokens) {
            newContent.unshift(part);
            messageTokenCount += imageTokenCount;
            resultTokenCount += imageTokenCount;
          } else {
            break; // Skip the entire image message part if it exceeds the limit
          }
        }
      }

      if (newContent.length > 0) {
        acc.unshift({ ...message, content: newContent });
      }
    } else {
      const tokens = tokenizeText(message.content);
      if (resultTokenCount + tokens.length <= maxTokens) {
        acc.unshift(message);
        resultTokenCount += tokens.length;
      } else {
        const tokensAvailable = maxTokens - resultTokenCount;
        if (tokensAvailable > 0) {
          const partialTokens = tokens.slice(0, tokensAvailable);
          const partialContent = convertTokensToText(partialTokens);
          acc.unshift({ ...message, content: partialContent });
          resultTokenCount += tokensAvailable;
          console.log(formatLogMessage(ctx, `Partial tokens added (message.content): ${tokensAvailable}, resultTokenCount: ${resultTokenCount}`));
        }
        return acc;
      }
    }
    return acc;
  }, []);

  return messagesCleaned;
}

export function countTotalTokens(messages: MyMessage[]): number {
  return messages.reduce((total, message) => {
    if (Array.isArray(message.content)) {
      const messageTokens = message.content.reduce((msgTotal, part) => {
        if (part.type === 'text') {
          return msgTotal + tokenizeText(part.text!).length;
        } else if (part.type === 'image_url') {
          return msgTotal + APPROX_IMAGE_TOKENS;
        }
        return msgTotal;
      }, 0);
      return total + messageTokens;
    } else {
      return total + tokenizeText(message.content).length;
    }
  }, 0);
}

export async function createCompletionWithRetriesAndMemory(
  ctx: MyContext,
  messages: MyMessage[],
  openai: OpenAI,
  pineconeIndex: any,
  retries = 5,
  timeoutMs = CHAT_GPT_DEFAULT_TIMEOUT_MS
): Promise<AxiosResponse<OpenAI.Chat.Completions.ChatCompletion, any> | undefined> {
  try {
    // Add long-term memory to the messages based on pineconeIndex
    let referenceMessageObj: MyMessage | undefined = undefined;
    let referenceTextString : string = "";
    if (pineconeIndex) {
      const userMessages = messages.filter((message) => message.role === "user");
      const maxContentLength: number = 8192 - userMessages.length; // to add '\n' between messages
      // Make the embedding request and return the result
      const userMessagesCleaned = truncateHistoryToTokenLimit(
        ctx,
        userMessages,
        maxContentLength,
      )
      const userMessagesCleanedText = userMessagesCleaned.map((message) => message.content).join('\n');

      const resp = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: userMessagesCleanedText,
      });
      const embedding = resp?.data?.[0]?.embedding || null;

      const queryRequest = {
        vector: embedding,
        topK: 50,
        includeValues: false,
        includeMetadata: true,
      };
      const queryResponse = await pineconeIndex.query(queryRequest);

      referenceTextString =
        "Related to this conversation document parts:\n" + 
        queryResponse.matches.map((match: any) => match.metadata.text).join('\n');

      referenceMessageObj = {
        role: "assistant",
        content: referenceTextString,
      } as MyMessage;

      console.log(formatLogMessage(ctx, `referenceMessage added to the messages with ${queryResponse.matches.length} matches and ${referenceTextString.length} characters.`));
    }

    // Tokenize and account for default prompt and reference message
    const defaultPromptTokens = defaultPromptMessageObj ? tokenizeText(defaultPromptMessageString) : new Uint32Array();
    const referenceMessageTokens = referenceMessageObj ? tokenizeText(referenceTextString) : new Uint32Array();

    const adjustedTokenThreshold = MAX_TOKENS_THRESHOLD_TO_REDUCE_HISTORY - defaultPromptTokens.length - referenceMessageTokens.length;
    if (adjustedTokenThreshold <= 0) {
      throw new Error('Token threshold exceeded by default prompt and reference message.');
    }

    // Reduce history using tokens
    const messagesCleaned = truncateHistoryToTokenLimit(
      ctx,
      messages,
      adjustedTokenThreshold,
    );
    
    // DEBUG: Uncomment to see hidden and user messages in logs
    // console.log(`messagesCleaned: ${JSON.stringify(truncateMessages(messagesCleaned), null, 2)}`);

    let finalMessages = [defaultPromptMessageObj].filter(Boolean); // Ensure we don't include undefined
    if (referenceMessageObj) {
      finalMessages.push(referenceMessageObj);
    }
    finalMessages = finalMessages.concat(messagesCleaned);

    // Calculate total tokens
    const messagesCleanedTokensTotalLength = countTotalTokens(messagesCleaned);
    console.log(
      formatLogMessage(
        ctx, 
        `defaultPromptTokens: ${defaultPromptTokens.length}, referenceMessageTokens: ${referenceMessageTokens.length}, messagesCleanedTokens: ${messagesCleanedTokensTotalLength}, total: ${defaultPromptTokens.length + referenceMessageTokens.length + messagesCleanedTokensTotalLength} tokens out of ${MAX_TOKENS_THRESHOLD_TO_REDUCE_HISTORY}`
      )
    );
    
    // DEBUG: Uncomment to see hidden and user messages in logs
    // console.log(`finalMessages: ${JSON.stringify(truncateMessages(finalMessages), null, 2)}`);

    const chatGPTAnswer = await createChatCompletionWithRetries(
      finalMessages,
      openai,
      ctx,
      retries,
      timeoutMs
    );
    return chatGPTAnswer as AxiosResponse<OpenAI.Chat.Completions.ChatCompletion, any> | undefined;
  } catch (error) {
    throw error;
  }
}

export function transcribeAudioWithRetries(fileStream: File, openai: OpenAI, retries = 3): Promise<any> {
  return openai.audio.transcriptions.create({ model: "whisper-1", file: fileStream })
    .catch((error) => {
      if (retries === 0) {
        throw error;
      }
      console.error(`openai.createTranscription failed. Retries left: ${retries}`);
      return transcribeAudioWithRetries(fileStream, openai, retries - 1);
    });
}

const tools = [createPerplexityTool()];
