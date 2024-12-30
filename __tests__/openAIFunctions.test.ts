// Mock environment variables at the top of the file
process.env.OPENAI_API_KEY = 'test-openai-api-key';

import fs from 'fs';

// Mock the fs module
jest.mock('fs');

// Mock implementation for readFileSync
(fs.readFileSync as jest.Mock).mockImplementation((path: string, encoding: string) => {
  if (path === './temp/__temp_config.yaml') {
    return `
      gpt_model: 'gpt-4o'
      gpt_model_for_image_url: 'gpt-4o'
      strings:
        reset_message: 'Old messages deleted'
        no_openai_key_error: 'No OpenAI key provided. Please contact the bot owner.'
        trial_ended_error: 'Trial period ended. Please contact the bot owner.'
        trial_not_enabled_error: 'Trial period is not enabled. Please contact the bot owner.'
        no_video_error: 'Bot can not process videos.'
        no_answer_error: 'Bot can not answer to this message.'
        help_string: 'This is a bot that can chat with you. You can ask it questions or just chat with it. The bot will try to respond to you as best as it can. If you want to reset the conversation, just type /reset.'
        error_string: 'An error occurred. Please try again later.'
      max_trials_tokens: 0
      prompts:
        - name: 'default'
          text: 'This is the default prompt message.'
    `;
  }
  return '';
});

// Mock the tiktoken module
jest.mock('tiktoken', () => ({
  encoding_for_model: jest.fn(() => ({
    encode: jest.fn((text: string) => {
      // Mock encoding logic: return an array of numbers representing tokens
      return Array.from(text).map((_, index) => index + 1);
    }),
    free: jest.fn(),
  })),
  TiktokenModel: jest.fn(),
}));

// Import necessary modules after setting up the mock
import { truncateHistoryToTokenLimit, countTotalTokens, APPROX_IMAGE_TOKENS } from '../src/openAIFunctions';
import { MyContext, MyMessage } from '../src/types';

// Mock data
const mockMessages: MyMessage[] = [
  {
    role: 'user',
    content: 'This is a test message from the user.',
    chat_id: 1,
    user_id: 1,
  },
  {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'This is a response from the assistant.',
      },
    ],
    chat_id: 1,
    user_id: null,
  },
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Another message from the user that is really long and needs to be truncated. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      },
    ],
    chat_id: 1,
    user_id: 1,
  },
  {
    role: 'user',
    content: [
      {
        type: 'image_url',
        image_url: {
          url: "test_data_url"
        }
      },
    ],
    chat_id: 1,
    user_id: 1,
  }
];

// Mock context based on the provided data
const mockCtx: Partial<MyContext> = {
  chat: {
    id: -4063810597,
    title: "Dev bot 2 group",
    type: "group",
  },
  from: {
    id: 112249713,
    is_bot: false,
    first_name: "Test1",
    last_name: "Test2",
    username: "test_user",
    language_code: "en",
    is_premium: true,
  }
};

describe('truncateHistoryToTokenLimit', () => {
  it('should reduce history to fit within token limit', () => {
    const maxTokens = 0;
    const reducedMessages = truncateHistoryToTokenLimit(mockCtx as MyContext, mockMessages, maxTokens);

    // Validate the length of the reduced messages
    const totalTokens = countTotalTokens(reducedMessages);
    expect(totalTokens).toBeLessThanOrEqual(maxTokens);
  });

  it('should return an empty array if maxTokens is 0', () => {
    const maxTokens = 0;
    const reducedMessages = truncateHistoryToTokenLimit(mockCtx as MyContext, mockMessages, maxTokens);

    expect(reducedMessages).toEqual([]);
  });

  it('should handle messages with only image URLs', () => {
    const maxTokens = 1600; // More than enough for two images
    const imageMessages: MyMessage[] = [
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'image1_url' } }],
        chat_id: 1,
        user_id: 1,
      },
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'image2_url' } }],
        chat_id: 1,
        user_id: 1,
      },
    ];

    const reducedMessages = truncateHistoryToTokenLimit(mockCtx as MyContext, imageMessages, maxTokens);
    expect(reducedMessages.length).toEqual(2);
  });

  it('should handle a very high token limit', () => {
    const maxTokens = 10000; // Arbitrarily high token limit
    const reducedMessages = truncateHistoryToTokenLimit(mockCtx as MyContext, mockMessages, maxTokens);
    expect(reducedMessages).toEqual(mockMessages);
  });
});

describe('countTotalTokens', () => {
  it('should correctly calculate the total number of tokens', () => {
    const totalTokens = countTotalTokens(mockMessages);
    
    // Update the expected token count based on actual tokenization logic
    const expectedTokens = 1075; // Adjust this value based on your tokenization logic
    expect(totalTokens).toEqual(expectedTokens);
  });

  it('should return 0 for an empty array', () => {
    const totalTokens = countTotalTokens([]);
    expect(totalTokens).toEqual(0);
  });

  it('should correctly calculate tokens for mixed content types', () => {
    const mixedMessages: MyMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Short text' },
          { type: 'image_url', image_url: { url: 'image_url' } },
        ],
        chat_id: 1,
        user_id: 1,
      },
    ];

    const totalTokens = countTotalTokens(mixedMessages);
    const expectedTokens = 10 + APPROX_IMAGE_TOKENS; // Adjust based on actual tokenization logic
    expect(totalTokens).toEqual(expectedTokens);
  });
});
