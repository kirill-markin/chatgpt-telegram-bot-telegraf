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

jest.mock('fs', () => ({
  readFileSync: jest.fn((path: string, encoding: string) => {
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
  }),
  existsSync: jest.fn((path: string) => {
    return path === '.env'; // Mock the existence of the .env file
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