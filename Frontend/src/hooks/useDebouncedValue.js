import { useEffect, useState } from "react";

/**
 * Debounce a value that changes on every keystroke (a search box) so it only
 * reaches the query key once the user pauses.
 *
 * The report tables are served by the API, so without this each typed character
 * would fire its own request. The input keeps showing `value` immediately; only
 * the value the query reads is delayed.
 */
export default function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debounced;
}