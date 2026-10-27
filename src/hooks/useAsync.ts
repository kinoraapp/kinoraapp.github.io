import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (update: T | ((prev: T | undefined) => T)) => void;
}

/** Runs an async loader when `deps` change, ignoring results from stale runs. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setDataState] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const run = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const id = ++run.current;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((value) => {
        if (id === run.current) setDataState(value);
      })
      .catch((err) => {
        if (id === run.current) setError(err);
      })
      .finally(() => {
        if (id === run.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((update: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof update === "function" ? (update as (p: T | undefined) => T)(prev) : update));
  }, []);

  return { data, error, loading, reload, setData };
}
