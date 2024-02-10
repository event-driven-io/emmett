module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: './tsconfig.json',
      },
    ],
  },
  setupFilesAfterEnv: ['./jest.setup.js'],
  moduleNameMapper: {
    '#core/(.*)': '<rootDir>/src/core/$1',
    '#config': '<rootDir>/config.ts',
    '#testing/(.*)': '<rootDir>/src/testing/$1',
  },
};
