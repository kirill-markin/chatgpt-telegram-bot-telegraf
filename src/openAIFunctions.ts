import OpenAI from 'openai';
import { MyContext, MyMessage, UserData } from './types';
import { AxiosResponse } from 'axios';
import { encoding_for_model } from 'tiktoken';
import pTimeout from 'p-timeout';
import { toLogFormat } from './utils';
import { timeoutMsDefaultchatGPT, GPT_MODEL, maxTokensThresholdToReduceHistory, defaultPromptMessage } from './config';
import { usedTokensForUser, insertUserOrUpdate, selectUserByUserId } from './database';
import { maxTrialsTokens, OPENAI_API_KEY } from './config';

class NoOpenAiApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoOpenAiApiKeyError';
  }
}

// default prompt message to add to the GPT model

let defaultPromptMessageObj = {} as MyMessage;
if (defaultPromptMessage) {
  defaultPromptMessageObj = {
    "role": "assistant",
    "content": defaultPromptMessage.toString(),
  } as MyMessage;
} else {
  console.log('Default prompt message not found');
}

// OpenAI functions

export async function ensureUserSettingsAndRetrieveOpenAi(ctx: MyContext): Promise<UserData> {
  if (ctx.from && ctx.from.id) {
    const user_id = ctx.from.id;
    let userSettings = await selectUserByUserId(user_id);
    if (!userSettings) {
      // If the user is not found, create new settings
      userSettings = {
        user_id: user_id,
        username: ctx.from?.username || null,
        default_language_code: ctx.from?.language_code || null,
        language_code: ctx.from?.language_code || null,
      };
      await insertUserOrUpdate(userSettings); // Insert the new user
      console.log(toLogFormat(ctx, "User created in the database"));
    } else {
      // If the user is found, update their data
      userSettings.username = ctx.from?.username || userSettings.username;
      userSettings.default_language_code = ctx.from?.language_code || userSettings.default_language_code;
      userSettings.language_code = ctx.from?.language_code || userSettings.language_code;
      await insertUserOrUpdate(userSettings); // Update the user's data
      console.log(toLogFormat(ctx, "User data updated in the database"));
    }

    // Check if user has openai_api_key or is premium
    if (userSettings.openai_api_key) { // custom api key
      console.log(toLogFormat(ctx, `[ACCESS GRANTED] user has custom openai_api_key.`));
    } else if (userSettings.usage_type === 'premium') { // premium user
      userSettings.openai_api_key = OPENAI_API_KEY;
      console.log(toLogFormat(ctx, `[ACCESS GRANTED] user is premium but has no custom openai_api_key. openai_api_key set from environment variable.`));
    } else { // no access or trial
      const usedTokens = await usedTokensForUser(user_id);
      if (usedTokens < maxTrialsTokens) {
        userSettings.usage_type = 'trial_active';
        await insertUserOrUpdate(userSettings);
        userSettings.openai_api_key = OPENAI_API_KEY;
        console.log(toLogFormat(ctx, `[ACCESS GRANTED] user is trial and user did not exceed the message limit. User used tokens: ${usedTokens} out of ${maxTrialsTokens}. openai_api_key set from environment variable.`));
      } else {
        userSettings.usage_type = 'trial_ended';
        await insertUserOrUpdate(userSettings);
        console.log(toLogFormat(ctx, `[ACCESS DENIED] user is not premium and has no custom openai_api_key and exceeded the message limit. User used tokens: ${usedTokens} out of ${maxTrialsTokens}.`));
        throw new NoOpenAiApiKeyError(`User with user_id ${user_id} has no openai_api_key`);
      }
    }

    
    const openai = new OpenAI({
      apiKey: userSettings.openai_api_key,
    });
    return {settings: userSettings, openai: openai}
  } else {
    throw new Error('ctx.from.id is undefined');
  }
}

async function createChatCompletionWithRetry(messages: MyMessage[], openai: OpenAI, retries = 5, timeoutMs = timeoutMsDefaultchatGPT) {
  for (let i = 0; i < retries; i++) {
    try {
      const chatGPTAnswer = await pTimeout(
        openai.chat.completions.create({
          model: GPT_MODEL,
          messages: messages,
          temperature: 0.7,
          // max_tokens: 1000,
        }),
        timeoutMs,
      );

      // Assuming the API does not use a status property in the response to indicate success
      return chatGPTAnswer;
    } catch (error) {
      if (error instanceof pTimeout.TimeoutError) {
        console.error(`openai.createChatCompletion timed out. Retries left: ${retries - i - 1}`);
      } else if (error instanceof OpenAI.APIError) {
        console.error(`openai.createChatCompletion failed. Retries left: ${retries - i - 1}`);
        console.error(error.status);  // e.g. 401
        console.error(error.message); // e.g. The authentication token you passed was invalid...
        console.error(error.code);    // e.g. 'invalid_api_key'
        console.error(error.type);    // e.g. 'invalid_request_error'
      } else {
        // Non-API and non-timeout error
        console.error(error);
      }
      
      if (i === retries - 1) throw error;
    }
  }
}

export async function createChatCompletionWithRetryReduceHistoryLongtermMemory(ctx: MyContext, messages: MyMessage[], openai: OpenAI, pineconeIndex: any, retries = 5, timeoutMs = timeoutMsDefaultchatGPT): Promise<AxiosResponse<OpenAI.Chat.Completions.ChatCompletion, any> | undefined> {
  try {
    // Add longterm memory to the messages based on pineconeIndex

    let referenceMessageObj: any = undefined;
    if (pineconeIndex) {
      // Get embeddings for last user messages
      const lastMessagesThreshold = 4;
      const userMessagesText = messages
        .filter((message) => message?.role === "user")
        .slice(-lastMessagesThreshold)
        .map((message) => message.content)
        .join('\n');
      // Make the embedding request and return the result
      // FIXME reduce userMessagesText length to 8192 tokens and test
      const resp = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: userMessagesText,
      })
      const embedding = resp?.data?.[0]?.embedding || null;

      const queryRequest = {
        vector: embedding,
        topK: 50,
        includeValues: false,
        includeMetadata: true,
      };
      const queryResponse = await pineconeIndex.query( queryRequest );

      // TODO: add wiki URLs to the referenceMessage from metadata.source

      const referenceText =
        "Related to this conversation document parts:\n" 
        + queryResponse.matches.map(
            (match: any) => match.metadata.text
          ).join('\n');
      
      referenceMessageObj = {
        "role": "assistant",
        "content": referenceText,
      } as MyMessage;

      console.log(toLogFormat(ctx, `referenceMessage added to the messages with ${queryResponse.matches.length} matches and ${referenceText.length} characters.`));
    }


    // Reduce history using tokens, but consider defaultPrompt and referenceMessage lengths

    const encoder = encoding_for_model('gpt-3.5-turbo'); // or 'gpt-4' if it's available

    // Define your token threshold here
    const tokenThreshold = maxTokensThresholdToReduceHistory;
    let totalTokenCount = 0;

    // Tokenize and account for default prompt and reference message
    const defaultPromptTokens = defaultPromptMessageObj ? encoder.encode(defaultPromptMessageObj.content) : [];
    const referenceMessageTokens = referenceMessageObj ? encoder.encode(referenceMessageObj.content) : [];

    // Adjust tokenThreshold to account for the default prompt and reference message
    const adjustedTokenThreshold = tokenThreshold - defaultPromptTokens.length - referenceMessageTokens.length;

    // Check if adjustedTokenThreshold is valid
    if (adjustedTokenThreshold <= 0) {
      encoder.free(); // Free the encoder before throwing error
      throw new Error('Token threshold exceeded by default prompt and reference message. Max token threshold: ' + tokenThreshold + ', default prompt length: ' + defaultPromptTokens.length + ', reference message length: ' + referenceMessageTokens.length);
    }

    // Tokenize messages and calculate total token count
    let messagesCleaned = messages.reduceRight<MyMessage[]>((acc, message) => {
      const tokens = encoder.encode(message.content);
      if (totalTokenCount + tokens.length <= adjustedTokenThreshold) {
        acc.unshift(message); // Prepend to keep the original order
        totalTokenCount += tokens.length;
      } else {
        // When we can't add the entire message, we need to add a truncated part of it
        const tokensAvailable = adjustedTokenThreshold - totalTokenCount;
        if (tokensAvailable > 0) {
          // We can include a part of this message
          // Take tokens from the end instead of the start
          const partialTokens = tokens.slice(-tokensAvailable);
          const partialContentArray = encoder.decode(partialTokens);
          // Convert Uint8Array to string
          const partialContent = new TextDecoder().decode(partialContentArray);
          acc.unshift({ ...message, content: partialContent });
          totalTokenCount += tokensAvailable; // This should now equal adjustedTokenThreshold
        }
        // Once we've hit the token limit, we don't add any more messages
        return acc;
      }
      return acc;
    }, []);

    if (messages.length !== messagesCleaned.length) {  
      console.log(toLogFormat(ctx, `messages reduced, totalTokenCount: ${totalTokenCount} from adjustedTokenThreshold: ${adjustedTokenThreshold}. Original message count: ${messages.length}, reduced message count: ${messagesCleaned.length}.`));
    } else {
      console.log(toLogFormat(ctx, `messages not reduced, totalTokenCount: ${totalTokenCount} from adjustedTokenThreshold: ${adjustedTokenThreshold}.`));
    }

    encoder.free(); // Free the encoder when done


    let finalMessages = [defaultPromptMessageObj]
    if (referenceMessageObj) {
      finalMessages.push(referenceMessageObj);
    }
    finalMessages = finalMessages.concat(messagesCleaned);

    // TODO: Uncomment to see hidden and user messages in logs
    // console.log(JSON.stringify(finalMessages, null, 2));

    const chatGPTAnswer = await createChatCompletionWithRetry(
      messages = finalMessages,
      openai,
      retries,
      timeoutMs,
    );
    return chatGPTAnswer as AxiosResponse<OpenAI.Chat.Completions.ChatCompletion, any> | undefined;
  } catch (error) {
    throw error;
  }
}

export function createTranscriptionWithRetry(fileStream: File, openai: OpenAI, retries = 3): Promise<any> {
  return openai.audio.transcriptions.create({ model: "whisper-1", file: fileStream })
    .catch((error) => {
      if (retries === 0) {
        throw error;
      }
      console.error(`openai.createTranscription failed. Retries left: ${retries}`);
      return createTranscriptionWithRetry(fileStream, openai, retries - 1);
    });
}
