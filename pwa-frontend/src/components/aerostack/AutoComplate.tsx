import { useEffect, useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { searchDeelPeople } from "@/api/loops";

export const OwnerEmailInput = ({ value, onChange }: any) => {
  const [results, setResults] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const requestIdRef = useRef(0);
  const isSelectingRef = useRef(false); // Track if user is selecting from dropdown

  useEffect(() => {
    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // If user just selected an email, don't search
    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      return;
    }

    // Clear results and close dropdown immediately if value is empty or too short
    if (!value || value.length < 1) {
      setResults([]);
      setOpen(false);
      setIsLoading(false);
      return;
    }

    // Increment request ID for this new search
    const currentRequestId = ++requestIdRef.current;

    // Clear previous results immediately when value changes
    setResults([]);
    setOpen(false);
    setIsLoading(true);

    timeoutRef.current = setTimeout(async () => {
      try {
        const emails = await searchDeelPeople(value);

        // Only update state if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          const validEmails = Array.isArray(emails) ? emails : [];
          setResults(validEmails);
          setOpen(validEmails.length > 0);
          setIsLoading(false);
        }
      } catch (err: any) {
        console.error("Error fetching emails:", err);
        // Only update state if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          setResults([]);
          setOpen(false);
          setIsLoading(false);
        }
      }
    }, 300);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < results.length - 1 ? prev + 1 : prev,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0) {
          const selectedEmail = results[highlightedIndex];
          isSelectingRef.current = true; // Mark as selecting
          onChange(selectedEmail);
          setOpen(false);
          setHighlightedIndex(-1);
        }
        break;
      case "Escape":
        setOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  const handleSelectEmail = (email: string) => {
    isSelectingRef.current = true; // Mark as selecting
    onChange(email);
    setOpen(false);
    setHighlightedIndex(-1);
    setResults([]);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    isSelectingRef.current = false; // User is typing, not selecting
    onChange(e.target.value);
  };

  const handleInputFocus = () => {
    // If there are existing results and value matches, show them
    if (results.length > 0 && value && value.length > 0) {
      setOpen(true);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <Input
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleInputFocus}
        placeholder="email@company.com"
        // className="border-orange-400 focus:border-orange-500 focus:ring-orange-500"
      />

      {open && results.length > 0 && !isLoading && (
        <div className="absolute left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto animate-slideDown">
          {results.map((email, index) => (
            <div
              key={email}
              onClick={() => handleSelectEmail(email)}
              className={`px-4 py-2.5 cursor-pointer transition-colors ${
                index === highlightedIndex
                  ? "bg-orange-50 text-orange-900"
                  : "hover:bg-gray-50"
              }`}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <p className="text-sm text-gray-900">{email}</p>
            </div>
          ))}
        </div>
      )}

      {isLoading && value && value.length > 0 && (
        <p className="text-sm text-gray-500"></p>
      )}

      <style>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-slideDown {
          animation: slideDown 0.15s ease-out;
        }
      `}</style>
    </div>
  );
};
