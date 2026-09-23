import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cache = mkdtempSync(join(tmpdir(), 'rn-network-quality-npm-cache-'));
let result;

try {
  result = spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', cache],
    { encoding: 'utf8' }
  );
} finally {
  rmSync(cache, { force: true, recursive: true });
}

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const reports = JSON.parse(result.stdout);
const files = reports[0]?.files?.map((entry) => entry.path) ?? [];
const required = [
  'package.json',
  'mock.js',
  'rn-network-quality.podspec',
  'ios/NetworkQuality.mm',
  'ios/NetworkQualityImpl.swift',
  'ios/PrivacyInfo.xcprivacy',
  'android/src/main/AndroidManifest.xml',
  'src/NativeNetworkQuality.ts',
  'lib/module/index.js',
];
const forbidden = [
  /^example\//,
  /^android\/src\/test\//,
  /__tests__\//,
  /(^|\/)build\//,
  /(^|\/)\.gradle\//,
  /(^|\/)\.cxx\//,
  /(^|\/)Pods\//,
  /(^|\/)coverage\//,
];

const missing = required.filter((path) => !files.includes(path));
const unexpected = files.filter((path) =>
  forbidden.some((pattern) => pattern.test(path))
);

if (missing.length > 0 || unexpected.length > 0) {
  if (missing.length > 0) {
    process.stderr.write(`Missing package files:\n${missing.join('\n')}\n`);
  }
  if (unexpected.length > 0) {
    process.stderr.write(
      `Unexpected package files:\n${unexpected.join('\n')}\n`
    );
  }
  process.exit(1);
}

process.stdout.write(`Package contents verified (${files.length} files).\n`);
