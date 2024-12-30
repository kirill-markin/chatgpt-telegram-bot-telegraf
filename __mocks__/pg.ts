export const Pool = jest.fn(() => ({
  query: jest.fn().mockResolvedValue({ rows: [{ id: 1, name: 'Test User' }] }),
  end: jest.fn(),
}));
