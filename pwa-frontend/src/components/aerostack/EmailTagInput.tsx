import React, { useEffect, useRef, useState } from "react";
import { searchDeelPeople } from "@/api/loops";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface Props {
  value: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
  /** Pre-loaded email pool for instant local filtering (e.g. workspace users). */
  localPool?: string[];
}

export const EmailTagInput: React.FC<Props> = ({
  value,
  onChange,
  placeholder,
  localPool = [],
}) => {
  const [input, setInput] = useState("");
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);

  // Keep a stable ref so the effect below doesn't re-fire when the parent
  // passes a new array literal on every render (which would cause an infinite loop).
  const localPoolRef = useRef(localPool);
  localPoolRef.current = localPool;

  // Search as user types — debounced
  useEffect(() => {
    const q = input.trim().toLowerCase();
    if (!q || q.length < 2) {
      setSearchResults([]);
      return;
    }

    // Immediately show matches from local pool (instant)
    const localMatches = localPoolRef.current
      .filter((e) => e.startsWith(q) && !value.includes(e))
      .slice(0, 10);
    setSearchResults(localMatches);

    // Also query the API for Deel + Person table results
    setSearching(true);
    const timeoutId = setTimeout(async () => {
      try {
        const apiResults = await searchDeelPeople(q);
        if (Array.isArray(apiResults)) {
          // Merge API results with local pool matches, dedupe
          const merged = new Set<string>(localMatches);
          for (const email of apiResults) {
            if (typeof email === "string" && !value.includes(email)) {
              merged.add(email.toLowerCase());
            }
          }
          setSearchResults(Array.from(merged).slice(0, 15));
        }
      } catch {
        // Keep local results on API failure
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [input, value]);

  const isValidEmail = (email: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const add = (email: string) => {
    const trimmedEmail = email.trim();
    if (trimmedEmail && !value.includes(trimmedEmail) && isValidEmail(trimmedEmail)) {
      onChange([...value, trimmedEmail]);
      setInput("");
      setSearchResults([]);
    }
  };

  const remove = (email: string) => {
    onChange(value.filter((v) => v !== email));
  };

  // Suggestions are search-driven only.
  const suggestedEmails = input.trim().length > 0 ? searchResults : [];

  return (
    <div className="space-y-2">
      {/* Selected emails */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((email) => (
            <Badge key={email} variant="secondary" className="group pr-1 pl-2 py-1">
              {email}
              <Button
                variant="ghost"
                size="icon"
                className="ml-1 h-4 w-4 p-0 hover:bg-destructive/10 rounded-full"
                onClick={(e) => {
                  e.preventDefault();
                  remove(email);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}

      {/* Input */}
      <Input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder || "Type email and press Enter..."}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (input.trim()) {
              add(input);
            }
          }
        }}
      />

      {/* Clickable suggestion badges */}
      {suggestedEmails.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 border rounded-md bg-background">
          {suggestedEmails.map((email) => (
            <Badge
              key={email}
              variant="outline"
              className="cursor-pointer hover:bg-primary/10 hover:border-primary text-xs py-1 px-2"
              onClick={() => add(email)}
            >
              + {email}
            </Badge>
          ))}
        </div>
      )}

      {searching && suggestedEmails.length === 0 && (
        <p className="text-xs text-muted-foreground">Searching...</p>
      )}

      {input && !isValidEmail(input) && input.length > 3 && suggestedEmails.length === 0 && (
        <p className="text-xs text-red-500 mt-1">
          Please enter a valid email address
        </p>
      )}
    </div>
  );
};
