import * as React from "react";

export function useDebouncedCallback<T extends (...args: never[]) => unknown>(
  callback: T,
  delay: number,
) {
  const callbackRef = React.useRef(callback);
  React.useEffect(() => { callbackRef.current = callback; });
  const handleCallback = React.useMemo(
    () => ((...args) => callbackRef.current?.(...args)) as T,
    [],
  );
  const debounceTimerRef = React.useRef(0);
  React.useEffect(
    () => () => window.clearTimeout(debounceTimerRef.current),
    [],
  );

  const setValue = React.useCallback(
    (...args: Parameters<T>) => {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(
        () => handleCallback(...args),
        delay,
      );
    },
    [handleCallback, delay],
  );

  return setValue;
}
