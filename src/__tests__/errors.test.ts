import { NetworkQualityError } from '../errors';

describe('NetworkQualityError', () => {
  it('preserves its stable code, cause, name, message, and prototype', () => {
    const cause = new Error('native failure');
    const error = new NetworkQualityError('E_PROBE_FAILED', 'Probe failed', {
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(NetworkQualityError);
    expect(error).toMatchObject({
      name: 'NetworkQualityError',
      code: 'E_PROBE_FAILED',
      message: 'Probe failed',
      cause,
    });
  });

  it('allows an omitted cause', () => {
    expect(
      new NetworkQualityError('E_OFFLINE', 'Offline').cause
    ).toBeUndefined();
  });
});
