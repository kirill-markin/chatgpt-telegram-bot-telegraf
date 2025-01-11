// Mock modules before importing anything else
jest.mock('fs');
jest.mock('tiktoken');
jest.mock('openai');

// Import necessary modules after setting up the mock
import { truncateHistoryToTokenLimit, countTotalTokens, APPROX_IMAGE_TOKENS, createCompletionWithRetriesAndMemory } from '../src/openAIFunctions';
import { MyContext, MyMessage } from '../src/types';
import OpenAI from 'openai';

// Mock environment variables at the top of the file
process.env.OPENAI_API_KEY = 'test-openai-api-key';

describe('OpenAI Functions', () => {
  let mockOpenAI: jest.Mocked<typeof OpenAI.prototype>;
  let mockContext: MyContext;

  beforeEach(() => {
    mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn()
        }
      }
    } as unknown as jest.Mocked<typeof OpenAI.prototype>;

    mockContext = {
      chat: { id: 123 },
      from: { id: 456 }
    } as MyContext;
  });

  describe('createCompletionWithRetriesAndMemory', () => {
    it('should select correct model for messages with images', async () => {
      const messages: MyMessage[] = [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: 'test_image_url' }
            }
          ],
          chat_id: 123,
          user_id: 456
        }
      ];

      (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValueOnce({
        choices: [{ message: { content: 'Test response' } }]
      });

      await createCompletionWithRetriesAndMemory(mockContext, messages, mockOpenAI, null);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'image_url',
                  image_url: { url: 'test_image_url' }
                })
              ])
            })
          ])
        })
      );
    });

    it('should preserve image content in formatted messages', async () => {
      const messages: MyMessage[] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'What is in this image?'
            },
            {
              type: 'image_url',
              image_url: { url: 'test_image_url' }
            }
          ],
          chat_id: 123,
          user_id: 456
        }
      ];

      (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValueOnce({
        choices: [{ message: { content: 'Test response' } }]
      });

      await createCompletionWithRetriesAndMemory(mockContext, messages, mockOpenAI, null);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'text',
                  text: 'What is in this image?'
                }),
                expect.objectContaining({
                  type: 'image_url',
                  image_url: { url: 'test_image_url' }
                })
              ])
            })
          ])
        })
      );
    });

    it('should handle mixed content messages correctly', async () => {
      const messages: MyMessage[] = [
        {
          role: 'user',
          content: 'Text only message',
          chat_id: 123,
          user_id: 456
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Message with image'
            },
            {
              type: 'image_url',
              image_url: { url: 'test_image_url' }
            }
          ],
          chat_id: 123,
          user_id: 456
        }
      ];

      (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValueOnce({
        choices: [{ message: { content: 'Test response' } }]
      });

      await createCompletionWithRetriesAndMemory(mockContext, messages, mockOpenAI, null);

      const createCall = (mockOpenAI.chat.completions.create as jest.Mock).mock.calls[0][0];
      
      // Find our messages by content instead of relying on specific indices
      const allMessages = createCall.messages;
      const textOnlyMessage = allMessages.find((m: { content: string | any[] }) => m.content === 'Text only message');
      const messageWithImage = allMessages.find((m: { content: string | any[] }) => Array.isArray(m.content) && m.content[0].text === 'Message with image');

      expect(textOnlyMessage).toBeDefined();
      expect(textOnlyMessage?.content).toBe('Text only message');
      
      expect(messageWithImage).toBeDefined();
      expect(messageWithImage?.content).toEqual([
        {
          type: 'text',
          text: 'Message with image'
        },
        {
          type: 'image_url',
          image_url: { url: 'test_image_url' }
        }
      ]);
    });
  });

  // Existing tests for truncateHistoryToTokenLimit and countTotalTokens...
  // ... existing code ...
});
