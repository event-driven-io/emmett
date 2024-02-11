module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/docs'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: './tsconfig.jest.json',
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
