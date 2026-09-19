import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "@/services/api";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const RECENT_KEY = "admin_recent_searches";

function readRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch {
    return [];
  }
}

function persistRecentSearch(query) {
  if (!query) {
    return;
  }

  const next = [query, ...readRecentSearches().filter((value) => value !== query)].slice(0, 10);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export default function AdminCommandPalette({ open, onOpenChange, basePath = "/admin" }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event) => {
      const isHotkey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!isHotkey) {
        return;
      }

      event.preventDefault();
      onOpenChange(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }

    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }

    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        setLoading(true);
        setError("");
        const response = await adminApi.search(query.trim(), { signal: controller.signal });
        setResults(Array.isArray(response?.data) ? response.data : []);
      } catch (apiError) {
        if (apiError?.name !== "AbortError") {
          setError(apiError?.message || "Search failed.");
        }
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [open, query]);

  const recentSearches = readRecentSearches();

  const navigateToResult = (item) => {
    persistRecentSearch(query.trim());
    onOpenChange(false);
    const defaultPath = `${basePath}/dashboard`;
    const candidatePath = String(item.path || defaultPath);
    const resolvedPath = candidatePath.startsWith("/admin/") && basePath !== "/admin"
      ? candidatePath.replace("/admin", basePath)
      : candidatePath;
    navigate(resolvedPath || defaultPath);
  };

  const rerunRecent = (value) => {
    setQuery(value);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Admin Search" description="Search tests, students, batches, and events">
      <Command>
        <CommandInput placeholder="Search tests, students, batches, events..." value={query} onValueChange={setQuery} />
        <CommandList>
          {!query.trim() ? (
            <CommandGroup heading="Recent Searches">
              {recentSearches.length === 0 ? (
                <CommandItem disabled>No recent searches</CommandItem>
              ) : (
                recentSearches.map((value) => (
                  <CommandItem key={value} onSelect={() => rerunRecent(value)}>
                    {value}
                  </CommandItem>
                ))
              )}
            </CommandGroup>
          ) : null}

          {query.trim().length === 1 ? <CommandEmpty>Type at least 2 characters to search.</CommandEmpty> : null}
          {loading ? <CommandEmpty>Searching...</CommandEmpty> : null}
          {!loading && error ? <CommandEmpty>{error}</CommandEmpty> : null}
          {!loading && !error && query.trim().length >= 2 && results.length === 0 ? (
            <CommandEmpty>No results. Try searching by roll number for students.</CommandEmpty>
          ) : null}

          {results.length > 0 ? (
            <CommandGroup heading="Results">
              {results.map((item) => (
                <CommandItem key={`${item.type}-${item.id}`} onSelect={() => navigateToResult(item)}>
                  <span>{item.title}</span>
                  <span className="ml-auto text-xs text-text-secondary">{item.subtitle || item.type}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
