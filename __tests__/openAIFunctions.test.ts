// Mock modules before importing anything else
jest.mock('fs');
jest.mock('tiktoken');

// Import necessary modules after setting up the mock
import { truncateHistoryToTokenLimit, countTotalTokens, APPROX_IMAGE_TOKENS } from '../src/openAIFunctions';
import { MyContext, MyMessage } from '../src/types';

// Mock environment variables at the top of the file
process.env.OPENAI_API_KEY = 'test-openai-api-key';

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
    // Test for approximate token count based on message content length
    expect(totalTokens).toBeGreaterThan(0);
    expect(totalTokens).toBeLessThan(2000);
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
    expect(totalTokens).toBeGreaterThan(APPROX_IMAGE_TOKENS); // Should include image tokens
  });
});
