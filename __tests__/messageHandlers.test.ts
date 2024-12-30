import { MyContext, MyMessage } from '../src/types';
import { saveMessagesToDatabase, handleAnyMessage } from '../src/messageHandlers';
import { addMessagesBatch } from '../src/database/database';

// Mock console methods
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

// Mock the database functions
jest.mock('../src/database/database', () => ({
  addMessagesBatch: jest.fn().mockImplementation(async (messages) => {
    if (messages.length === 0) {
      throw new Error('Database error');
    }
    return Promise.resolve(messages);
  }),
}));

describe('Message Handlers', () => {
  let mockContext: Partial<MyContext>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockContext = {
      chat: {
        id: 123456,
        type: 'private',
        first_name: 'Test User',
        username: 'testuser'
      },
      from: {
        id: 789012,
        is_bot: false,
        first_name: 'Test',
        username: 'testuser',
      },
    };
  });

  describe('saveMessagesToDatabase', () => {
    it('should successfully save messages to database', async () => {
      const messages: MyMessage[] = [
        {
          role: 'user',
          content: 'Test message',
          chat_id: 123456,
          user_id: 789012,
        },
      ];

      await saveMessagesToDatabase(mockContext as MyContext, messages);
      expect(addMessagesBatch).toHaveBeenCalledWith(messages);
    });

    it('should handle database errors gracefully', async () => {
      const messages: MyMessage[] = [];

      await expect(saveMessagesToDatabase(mockContext as MyContext, messages))
        .rejects
        .toThrow('Database error');
    });
  });
}); 