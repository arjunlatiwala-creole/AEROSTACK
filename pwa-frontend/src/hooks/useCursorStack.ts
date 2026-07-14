import { useState } from "react";

export const useCursorStack = () => {
  // Stack can hold string or null
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);

  const pushCursor = (lastKey: string | null) => {
    if (!lastKey) return; // don't push null for the last page
    setCursorStack((prev) => [...prev, lastKey]);
  };

  const popCursor = () => {
    if (cursorStack.length > 1) {
      setCursorStack((prev) => prev.slice(0, -1));
    }
  };

  const reset = () => setCursorStack([null]);

  const currentLastKey = cursorStack[cursorStack.length - 1] || null;

  return {
    pushCursor,
    popCursor,
    reset,
    currentLastKey,
    hasPrev: cursorStack.length > 1,
  };
};
