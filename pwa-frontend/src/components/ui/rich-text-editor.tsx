import React, { useRef, useEffect } from "react";
import { Bold, Italic, List, ListOrdered, Undo, Redo, RemoveFormatting } from "lucide-react";

interface RichTextEditorProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}

export function RichTextEditor({
  value,
  onChange,
  disabled = false,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  // Synchronize incoming value changes with editor innerHTML
  useEffect(() => {
    if (editorRef.current) {
      const currentHTML = editorRef.current.innerHTML;
      const targetHTML = value || "";
      if (currentHTML !== targetHTML) {
        editorRef.current.innerHTML = targetHTML;
      }
    }
  }, [value]);

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const execCommand = (command: string, value = "") => {
    document.execCommand(command, false, value);
    handleInput();
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  return (
    <div className="border border-input rounded-md overflow-hidden bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 p-1 bg-muted/40 border-b border-input">
        <button
          type="button"
          onClick={() => execCommand("bold")}
          disabled={disabled}
          className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
          title="Bold"
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => execCommand("italic")}
          disabled={disabled}
          className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
          title="Italic"
        >
          <Italic className="h-4 w-4" />
        </button>
        <div className="h-4 w-px bg-border mx-1" />
        <button
          type="button"
          onClick={() => execCommand("insertUnorderedList")}
          disabled={disabled}
          className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
          title="Bullet List"
        >
          <List className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => execCommand("insertOrderedList")}
          disabled={disabled}
          className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
          title="Numbered List"
        >
          <ListOrdered className="h-4 w-4" />
        </button>
        <div className="h-4 w-px bg-border mx-1" />
        <button
          type="button"
          onClick={() => execCommand("undo")}
          disabled={disabled}
          className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
          title="Undo"
        >
          <Undo className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => execCommand("redo")}
          disabled={disabled}
          className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors"
          title="Redo"
        >
          <Redo className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => execCommand("removeFormat")}
          disabled={disabled}
          className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-colors ml-auto"
          title="Clear Formatting"
        >
          <RemoveFormatting className="h-4 w-4" />
        </button>
      </div>

      {/* Editor Content Area */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        onInput={handleInput}
        className="p-3 min-h-[140px] max-h-[300px] overflow-y-auto outline-none rich-text-content prose prose-sm dark:prose-invert max-w-none"
      />
    </div>
  );
}
