module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.[jt]s?(x)'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/NativeNetworkQuality.ts',
    '!src/**/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      lines: 90,
    },
  },
};
