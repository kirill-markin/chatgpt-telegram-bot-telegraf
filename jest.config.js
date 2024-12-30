/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    setupFiles: ['<rootDir>/jest.setup.js'],
    transform: {
        '^.+\\.ts?$': 'ts-jest',
    },
    testMatch: ['**/__tests__/**/*.[jt]s?(x)'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    moduleNameMapper: {
        '^tiktoken$': '<rootDir>/__mocks__/tiktoken.js'
    },
};