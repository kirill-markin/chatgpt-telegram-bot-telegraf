module.exports = {
    encoding_for_model: jest.fn(() => ({
      encode: jest.fn((text) => {
        // Return a more realistic token count based on text length
        const tokenCount = Math.ceil(text.length / 4); // Approximate 4 chars per token
        return new Uint32Array(Array(tokenCount).fill(1));
      }),
      decode: jest.fn(tokens => new TextEncoder().encode('mocked_text')),
      free: jest.fn(),
    })),
    TiktokenModel: {
      'gpt-3.5-turbo': 'gpt-3.5-turbo',
      'gpt-4': 'gpt-4',
      'gpt-5': 'gpt-5',
    },
  };