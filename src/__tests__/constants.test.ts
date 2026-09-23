import { DEFAULT_CONFIG } from '../constants';

describe('DEFAULT_CONFIG', () => {
  it('uses a throughput payload large enough for fast connections', () => {
    const downloadUrl = DEFAULT_CONFIG.probe.downloadUrl;
    expect(downloadUrl).not.toBeNull();
    if (downloadUrl === null) throw new Error('Expected a download URL');

    const bytes = Number(new URL(downloadUrl).searchParams.get('bytes'));
    expect(bytes).toBeGreaterThanOrEqual(1_000_000);
    expect(bytes).toBeLessThanOrEqual(2_000_000);
  });
});
