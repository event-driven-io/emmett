module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/docs', '<rootDir>/packages'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: './tsconfig.jest.json',
      },
    ],
  },

  transformIgnorePatterns: ['<rootDir>/node_modules/'],
  setupFilesAfterEnv: ['./jest.setup.js'],
  moduleNameMapper: {
    '#core/(.*)': '<rootDir>/src/core/$1',
    '#config': '<rootDir>/config.ts',
    '#testing/(.*)': '<rootDir>/src/testing/$1',
    '^@event-driven.io/(.*)$': '<rootDir>/packages/$1/',
  },
};
