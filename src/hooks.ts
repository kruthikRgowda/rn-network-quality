import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { NetworkQualityError } from './errors';
import {
  addNetworkQualityListener,
  assertNetworkQualitySupported,
  getCachedNetworkQualityState,
  probeNetwork,
} from './manager';
import type { NetworkQualityState, ProbeConfig, ProbeResult } from './types';

function subscribe(onStoreChange: () => void): () => void {
  const subscription = addNetworkQualityListener(() => {
    onStoreChange();
  });
  return () => subscription.remove();
}

function getServerSnapshot(): null {
  return null;
}

/** Subscribes a React component to the referentially stable live state. */
export function useNetworkQuality(): NetworkQualityState | null {
  const state = useSyncExternalStore(
    subscribe,
    getCachedNetworkQualityState,
    getServerSnapshot
  );
  assertNetworkQualitySupported();
  return state;
}

/** State and trigger returned by `useNetworkProbe`. */
export interface UseNetworkProbeResult {
  /** Starts a de-duplicated active network probe. */
  probe: (options?: Partial<ProbeConfig>) => Promise<ProbeResult>;
  /** Whether this hook's most recent request is still running. */
  isProbing: boolean;
  /** Most recent successful result started by this hook. */
  result: ProbeResult | null;
  /** Most recent probe failure started by this hook. */
  error: NetworkQualityError | null;
}

function asNetworkQualityError(error: unknown): NetworkQualityError {
  return error instanceof NetworkQualityError
    ? error
    : new NetworkQualityError(
        'E_PROBE_FAILED',
        error instanceof Error ? error.message : 'The network probe failed',
        { cause: error }
      );
}

/** Provides imperative probing with React-friendly loading and error state. */
export function useNetworkProbe(): UseNetworkProbeResult {
  const mounted = useRef(true);
  const requestId = useRef(0);
  const [isProbing, setIsProbing] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<NetworkQualityError | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
    };
  }, []);

  const probe = useCallback(
    async (options?: Partial<ProbeConfig>): Promise<ProbeResult> => {
      const currentRequest = requestId.current + 1;
      requestId.current = currentRequest;
      if (mounted.current) {
        setIsProbing(true);
        setError(null);
      }

      try {
        const nextResult = await probeNetwork(options);
        if (mounted.current && requestId.current === currentRequest) {
          setResult(nextResult);
        }
        return nextResult;
      } catch (caught) {
        const nextError = asNetworkQualityError(caught);
        if (mounted.current && requestId.current === currentRequest) {
          setError(nextError);
        }
        throw nextError;
      } finally {
        if (mounted.current && requestId.current === currentRequest) {
          setIsProbing(false);
        }
      }
    },
    []
  );

  assertNetworkQualitySupported();
  return { probe, isProbing, result, error };
}
