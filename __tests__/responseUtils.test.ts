import { reply, sendSplitMessage, sendResponse } from '../src/utils/responseUtils';
import { MyContext } from '../src/types';
import { NO_ANSWER_ERROR } from '../src/config';

describe('Response Utils', () => {
  let mockContext: Partial<MyContext>;

  beforeEach(() => {
    mockContext = {
      reply: jest.fn(),
      chat: {
        id: 123,
        type: 'private',
        first_name: 'Test User',
        username: 'testuser',
      },
    };
  });

  describe('reply', () => {
    it('should send a message successfully on first attempt', async () => {
      await reply(mockContext as MyContext, 'Test message', 'test');
      expect(mockContext.reply).toHaveBeenCalledWith('Test message', { parse_mode: 'Markdown' });
    });

    it('should retry on failure', async () => {
      mockContext.reply = jest.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(true);

      await reply(mockContext as MyContext, 'Test message', 'test');
      expect(mockContext.reply).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendSplitMessage', () => {
    it('should split long messages', async () => {
      const longMessage = 'a'.repeat(5000);
      await sendSplitMessage(mockContext as MyContext, longMessage);
      expect(mockContext.reply).toHaveBeenCalledTimes(2);
    });

    it('should send short messages as is', async () => {
      const shortMessage = 'Hello, world!';
      await sendSplitMessage(mockContext as MyContext, shortMessage);
      expect(mockContext.reply).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendResponse', () => {
    it('should handle successful chat response', async () => {
      const chatResponse = {
        choices: [{
          message: {
            content: 'Test response',
          },
        }],
      };

      await sendResponse(mockContext as MyContext, chatResponse);
      expect(mockContext.reply).toHaveBeenCalledWith('Test response', { parse_mode: 'Markdown' });
    });

    it('should handle empty chat response with error message', async () => {
      await sendResponse(mockContext as MyContext, {});
      expect(mockContext.reply).toHaveBeenCalledWith(NO_ANSWER_ERROR, { parse_mode: 'Markdown' });
    });
  });
}); 