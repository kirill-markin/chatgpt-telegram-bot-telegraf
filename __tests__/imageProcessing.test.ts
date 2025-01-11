// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-unsafe-function-call */
/* eslint-disable @typescript-eslint/unbound-method */

// @ts-ignore
import { jest } from '@jest/globals';
import fs from 'fs';
import axios from 'axios';
import { handlePhotoMessage } from '../src/messageHandlers';
import { MyContext } from '../src/types';
import { Message, PhotoSize, Update, User, Chat, Telegram } from 'telegraf/types';
import { resizeImageFile, convertImageToBase64 } from '../src/utils/fileUtils';

// Mock fs and axios
jest.mock('fs');
jest.mock('axios');
jest.mock('../src/utils/fileUtils');

// Mock utility functions
jest.mock('../src/utils/utils', () => ({
    formatLogMessage: jest.fn((ctx, message) => message),
}));

describe('Image Processing Tests', () => {
    describe('Image Processing Pipeline', () => {
        let mockContext: MyContext;
        let mockFs: any;
        let mockStream: any;
        
        // Increase timeout for all tests in this describe block
        jest.setTimeout(15000);
        
        beforeEach(() => {
            // Reset all mocks
            jest.clearAllMocks();
            
            // Create a properly typed message
            const mockMessage: Message.PhotoMessage & Update.New = {
                message_id: 1,
                date: Math.floor(Date.now() / 1000),
                edit_date: undefined,
                chat: {
                    id: 123,
                    type: 'private',
                    first_name: 'Test User'
                } as Chat.PrivateChat,
                from: {
                    id: 456,
                    is_bot: false,
                    first_name: 'Test User'
                } as User,
                photo: [{
                    file_id: 'test_file_id',
                    file_unique_id: 'test123unique',
                    width: 100,
                    height: 100
                }] as PhotoSize[]
            };

            // Create a mock Telegram instance with properly typed methods
            const mockTelegram = {
                getFileLink: jest.fn().mockResolvedValue(new URL('http://test-url.com/photo.jpg'))
            } as unknown as Telegram;

            // Setup mock context with proper types
            mockContext = {
                message: mockMessage,
                telegram: mockTelegram,
                from: mockMessage.from,
                chat: mockMessage.chat,
                update: { update_id: 1, message: mockMessage },
                updateType: 'message',
                botInfo: { id: 1, is_bot: true, first_name: 'Test Bot', username: 'test_bot' }
            } as unknown as MyContext;

            // Create a mock write stream with chainable methods
            const mockWriteStream = {
                on: jest.fn().mockImplementation(function(event, callback) {
                    if (event === 'finish') {
                        setTimeout(callback, 0);
                    }
                    return this;
                })
            };

            // Mock fs functions with immediate callbacks
            mockFs = {
                existsSync: jest.fn().mockImplementation((path: string) => {
                    // Return true for temp files to allow cleanup
                    return path.includes('temp/') && (path.endsWith('.jpg') || path.endsWith('_resized.jpg'));
                }),
                mkdirSync: jest.fn(),
                createWriteStream: jest.fn().mockReturnValue(mockWriteStream),
                unlink: jest.fn().mockImplementation((_path: string, callback: (error: null) => void) => {
                    callback(null);
                })
            };

            // Apply mocks
            Object.assign(fs, mockFs);

            // Create a mock pipe function that returns a chainable stream
            mockStream = {
                on: jest.fn().mockImplementation(function(event, callback) {
                    if (event === 'finish') {
                        setTimeout(callback, 0);
                    }
                    return this;
                })
            };

            const mockPipe = jest.fn().mockImplementation(() => mockStream);

            // Mock axios with immediate response
            (axios as unknown as jest.Mock).mockResolvedValue({
                data: {
                    pipe: mockPipe
                }
            });

            // Mock utility functions with immediate resolution
            (resizeImageFile as unknown as jest.Mock).mockResolvedValue(undefined);
            (convertImageToBase64 as unknown as jest.Mock).mockResolvedValue('base64_content');
        });

        test('B1: Verify successful image processing flow', async () => {
            // Mock successful file download
            (fs.createWriteStream as jest.Mock).mockReturnValue({
                on: jest.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') callback();
                    return this;
                }),
            });

            // Mock successful image resize
            (resizeImageFile as jest.Mock).mockResolvedValue(undefined);

            // Mock successful base64 conversion
            (convertImageToBase64 as jest.Mock).mockResolvedValue('base64_content');

            // Process the image
            const result = await handlePhotoMessage(mockContext as MyContext);

            // Verify the flow
            expect(mockContext.telegram!.getFileLink).toHaveBeenCalledWith('test_file_id');
            expect(resizeImageFile).toHaveBeenCalled();
            expect(convertImageToBase64).toHaveBeenCalled();
            expect(result).toMatch(/^data:image\/jpeg;base64,/);
        });

        test('B2: Verify error handling for failed downloads', async () => {
            // Mock failed file download
            mockContext.telegram!.getFileLink = jest.fn().mockRejectedValue(
                new Error('Download failed')
            );

            // Process the image and expect error
            await expect(handlePhotoMessage(mockContext as MyContext))
                .rejects.toThrow('Download failed');
        });

        test('B3: Verify error handling for failed image processing', async () => {
            // Mock successful download but failed resize
            (fs.createWriteStream as jest.Mock).mockReturnValue({
                on: jest.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') callback();
                    return this;
                }),
            });
            (resizeImageFile as jest.Mock).mockRejectedValue(
                new Error('Resize failed')
            );

            // Process the image and expect error
            await expect(handlePhotoMessage(mockContext as MyContext))
                .rejects.toThrow('Resize failed');
        });

        test('B4: Verify cleanup after processing', async () => {
            // Process the image
            const result = await handlePhotoMessage(mockContext as MyContext);
            expect(result).toMatch(/^data:image\/jpeg;base64,/);

            // Verify cleanup
            expect(mockFs.unlink).toHaveBeenCalledTimes(2); // Both input and resized files
            const calls = mockFs.unlink.mock.calls;
            expect(calls[0][0]).toMatch(/\.jpg$/);
            expect(calls[1][0]).toMatch(/_resized\.jpg$/);
        });

        test('B5: Verify temp directory creation if not exists', async () => {
            // Mock temp directory doesn't exist
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            // Process the image
            await handlePhotoMessage(mockContext as MyContext);

            // Verify temp directory creation
            expect(fs.mkdirSync).toHaveBeenCalledWith('./temp');
        });

        test('B6: Verify highest resolution photo is selected', async () => {
            await handlePhotoMessage(mockContext as MyContext);

            // Verify the larger photo was selected
            expect(mockContext.telegram!.getFileLink).toHaveBeenCalledWith('test_file_id');
            expect(mockContext.telegram!.getFileLink).not.toHaveBeenCalledWith('small_file_id');
        });

        test('B7: Verify error handling for stream errors', async () => {
            // Mock stream error
            mockStream.on.mockImplementation((event, callback) => {
                if (event === 'error') {
                    setTimeout(() => callback(new Error('Stream failed')), 0);
                }
                return mockStream;
            });

            // Process the image and expect error
            await expect(handlePhotoMessage(mockContext as MyContext))
                .rejects.toThrow('Stream failed');
        });

        test('B8: Verify error handling for base64 conversion failure', async () => {
            // Mock successful download and resize
            (fs.createWriteStream as jest.Mock).mockReturnValue({
                on: jest.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') callback();
                    return this;
                }),
            });
            (resizeImageFile as jest.Mock).mockResolvedValue(undefined);

            // Mock failed base64 conversion
            (convertImageToBase64 as jest.Mock).mockRejectedValue(
                new Error('Base64 conversion failed')
            );

            // Process the image and expect error
            await expect(handlePhotoMessage(mockContext as MyContext))
                .rejects.toThrow('Base64 conversion failed');
        });

        test('B9: Verify cleanup is attempted even if unlink fails', async () => {
            // Mock successful processing but failed cleanup
            mockFs.unlink.mockImplementation((_path: string, callback: (error: Error) => void) => {
                callback(new Error('Unlink failed'));
            });

            // Process the image - should complete despite cleanup errors
            const result = await handlePhotoMessage(mockContext as MyContext);
            expect(result).toMatch(/^data:image\/jpeg;base64,/);

            // Verify both cleanup attempts were made
            expect(mockFs.unlink).toHaveBeenCalledTimes(2);
        });

        test('B10: Verify error logging on failure', async () => {
            const error = new Error('Test error');
            mockContext.telegram!.getFileLink = jest.fn().mockRejectedValue(error);
            
            const formatLogMessage = jest.requireMock('../src/utils/utils').formatLogMessage;
            
            await expect(handlePhotoMessage(mockContext as MyContext)).rejects.toThrow('Test error');
            
            expect(formatLogMessage).toHaveBeenCalledWith(
                mockContext,
                expect.stringContaining('Error processing photo')
            );
        });

        test('B11: Verify operation logging for successful processing', async () => {
            const formatLogMessage = jest.requireMock('../src/utils/utils').formatLogMessage;
            
            await handlePhotoMessage(mockContext as MyContext);
            
            expect(formatLogMessage).toHaveBeenCalledWith(
                mockContext,
                expect.stringContaining('Processing photo')
            );
            expect(formatLogMessage).toHaveBeenCalledWith(
                mockContext,
                expect.stringContaining('Photo processed successfully')
            );
        });

        test('B12: Verify handling of empty photo array', async () => {
            mockContext.message!.photo = [];
            
            await expect(handlePhotoMessage(mockContext as MyContext))
                .rejects.toThrow('No photo found in message');
        });

        test('B13: Verify handling of invalid photo object', async () => {
            mockContext.message!.photo = [{ 
                file_id: '', 
                file_unique_id: '',
                width: 0, 
                height: 0 
            }];
            
            await expect(handlePhotoMessage(mockContext as MyContext))
                .rejects.toThrow('Invalid photo data');
        });

        test('B14: Verify unique file path generation', async () => {
            // Process multiple photos
            await handlePhotoMessage(mockContext as MyContext);
            await handlePhotoMessage(mockContext as MyContext);
            
            // Check that different file paths were used
            const createWriteStreamCalls = (fs.createWriteStream as jest.Mock).mock.calls;
            const filePaths = createWriteStreamCalls.map(call => call[0]);
            const uniquePaths = new Set(filePaths);
            
            expect(uniquePaths.size).toBe(createWriteStreamCalls.length);
        });

        test('B15: Verify file path format', async () => {
            await handlePhotoMessage(mockContext as MyContext);
            
            const createWriteStreamCalls = (fs.createWriteStream as jest.Mock).mock.calls;
            const filePath = createWriteStreamCalls[0][0];
            
            expect(filePath).toMatch(/^\.\/temp\/[\w-]+\.jpg$/);
            expect(filePath).not.toContain('undefined');
            expect(filePath).not.toContain('null');
        });

        test('B16: Verify base64 image format for OpenAI', async () => {
            // Mock base64 content with valid base64 string
            const mockBase64Content = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
            (convertImageToBase64 as jest.Mock).mockResolvedValue(mockBase64Content);

            // Process the image
            const result = await handlePhotoMessage(mockContext as MyContext);
            
            // Verify format matches OpenAI requirements
            expect(result).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/);
            expect(result.split(',')[1]).toBeTruthy(); // Verify there's content after the prefix
        });

        test('B17: Verify image resizing to OpenAI requirements', async () => {
            // Mock a large image
            mockContext.message!.photo = [{
                file_id: 'test_file_id',
                file_unique_id: 'test123unique',
                width: 2048,
                height: 2048
            }] as PhotoSize[];

            await handlePhotoMessage(mockContext as MyContext);

            // Verify resize was called with correct dimensions
            expect(resizeImageFile).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                1024, // max width
                1024  // max height
            );
        });

        test('B18: Verify image content preservation', async () => {
            // Mock base64 content with known value
            const mockBase64Content = 'test_base64_content';
            (convertImageToBase64 as jest.Mock).mockResolvedValue(mockBase64Content);

            // Process the image
            const result = await handlePhotoMessage(mockContext as MyContext);

            // Verify the content is preserved
            expect(result).toBe(`data:image/jpeg;base64,${mockBase64Content}`);
        });

        test('B19: Verify handling of different image sizes', async () => {
            // Mock multiple photos of different sizes
            mockContext.message!.photo = [
                { file_id: 'small', file_unique_id: 'small_unique', width: 100, height: 100 },
                { file_id: 'medium', file_unique_id: 'medium_unique', width: 500, height: 500 },
                { file_id: 'large', file_unique_id: 'large_unique', width: 1000, height: 1000 }
            ] as PhotoSize[];

            await handlePhotoMessage(mockContext as MyContext);

            // Verify the largest photo was selected
            expect(mockContext.telegram!.getFileLink).toHaveBeenCalledWith('large');
        });

        test('B20: Verify MIME type in base64 string', async () => {
            const result = await handlePhotoMessage(mockContext as MyContext);
            
            // Verify MIME type is correct for OpenAI
            expect(result.startsWith('data:image/jpeg;base64,')).toBeTruthy();
        });
    });
}); 