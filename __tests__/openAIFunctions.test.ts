import { reduceHistoryWithTokenLimit, calculateTotalTokens, APPROX_IMAGE_TOKENS } from '../src/openAIFunctions';
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
    first_name: "Kirill",
    last_name: "Markin",
    username: "kirmark",
    language_code: "en",
    is_premium: true,
  }
};

describe('reduceHistoryWithTokenLimit', () => {
  it('should reduce history to fit within token limit', () => {
    const maxTokens = 0;
    const reducedMessages = reduceHistoryWithTokenLimit(mockCtx as MyContext, mockMessages, maxTokens);

    // Validate the length of the reduced messages
    const totalTokens = calculateTotalTokens(reducedMessages);
    expect(totalTokens).toBeLessThanOrEqual(maxTokens);
  });

  it('should return an empty array if maxTokens is 0', () => {
    const maxTokens = 0;
    const reducedMessages = reduceHistoryWithTokenLimit(mockCtx as MyContext, mockMessages, maxTokens);

    expect(reducedMessages).toEqual([]);
  });
});

describe('calculateTotalTokens', () => {
  it('should correctly calculate the total number of tokens', () => {
    const totalTokens = calculateTotalTokens(mockMessages);
    
    // Assuming some hypothetical token counts for the messages
    const expectedTokens = 54 + APPROX_IMAGE_TOKENS; // Replace this with the actual expected token count
    expect(totalTokens).toEqual(expectedTokens);
  });

  it('should return 0 for an empty array', () => {
    const totalTokens = calculateTotalTokens([]);
    expect(totalTokens).toEqual(0);
  });
});
