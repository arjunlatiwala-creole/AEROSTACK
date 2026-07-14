import { useState, useRef, useEffect, useMemo } from "react";
import { MessageSquare, Send, Paperclip, AtSign, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/auth/AuthContext";
import { useAddComment } from "@/hooks/useLoops";
import { searchDeelPeople, listWorkspaceUsers } from "@/api/loops";
import type { AerostackLoops } from "@enterprise/common";
import { fetchAuthSession } from "aws-amplify/auth";

type TaskComment = NonNullable<AerostackLoops.Loop["comments"]>[number];

interface TaskCommentsProps {
  loopId: string;
  comments: TaskComment[];
  contributors?: Array<{ email: string; share: number }>;
  ownerEmail?: string;
}

export function TaskComments({
  loopId,
  comments,
  contributors,
  ownerEmail,
}: TaskCommentsProps) {
  const auth = useAuth();
  const addComment = useAddComment();

  // Resolve the authenticated user's email from the Cognito ID token.
  // `auth.user.username` is the Cognito sub (UUID), NOT the email.
  const [userEmail, setUserEmail] = useState<string>("");
  useEffect(() => {
    if (!auth?.user) return;
    fetchAuthSession()
      .then((session) => {
        const email = session.tokens?.idToken?.payload?.email as
          | string
          | undefined;
        setUserEmail(email ?? "");
      })
      .catch(() => setUserEmail(""));
  }, [auth?.user]);

  const [content, setContent] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionStartIdx, setMentionStartIdx] = useState<number | null>(null);
  const [workspaceUsers, setWorkspaceUsers] = useState<string[]>([]);
  const [apiSuggestions, setApiSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Build list of mentionable people from contributors + owner
  const mentionablePeople = useMemo(() => {
    return buildMentionableList(contributors, ownerEmail, userEmail);
  }, [contributors, ownerEmail, userEmail]);

  // Load Google Workspace users on mount for instant client-side autocomplete
  useEffect(() => {
    listWorkspaceUsers()
      .then((users) => setWorkspaceUsers(users || []))
      .catch(() => { });
  }, []);

  // Fetch suggestions from backend when typing query >= 2 chars
  useEffect(() => {
    if (!showMentions || mentionFilter.length < 2) {
      setApiSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    let active = true;
    setLoadingSuggestions(true);
    searchDeelPeople(mentionFilter)
      .then((results: string[]) => {
        if (!active) return;
        setApiSuggestions(results || []);
      })
      .catch(() => {
        if (!active) return;
        setApiSuggestions([]);
      })
      .finally(() => {
        if (active) setLoadingSuggestions(false);
      });

    return () => {
      active = false;
    };
  }, [mentionFilter, showMentions]);

  // Combine local contributors, matching workspace users, and global API search suggestions
  const combinedSuggestions = useMemo(() => {
    const filter = mentionFilter.toLowerCase();
    if (!filter) return [];

    const matchesFilter = (email: string) => {
      const emailLower = email.toLowerCase();
      const namePart = emailLower.split("@")[0] || "";
      const segments = namePart.split(/[\._-]/);
      return emailLower.startsWith(filter) || segments.some((seg) => seg.startsWith(filter));
    };

    const localMatches = mentionablePeople.filter(matchesFilter);
    const workspaceMatches = workspaceUsers.filter(matchesFilter);
    const apiMatches = apiSuggestions.filter(matchesFilter);

    const deduped = new Set([...localMatches, ...workspaceMatches, ...apiMatches]);
    return Array.from(deduped);
  }, [mentionablePeople, workspaceUsers, mentionFilter, apiSuggestions]);

  const handleSubmit = () => {
    if (!content.trim()) return;

    // Extract @mentions from content
    const mentionRegex = /@([\w.+-]+@[\w.-]+)/g;
    const contentMentions: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(content)) !== null) {
      contentMentions.push(match[1]);
    }

    const allMentions = [...new Set([...selectedMentions, ...contentMentions])];

    addComment.mutate({
      loopId,
      data: {
        content: content.trim(),
        author_email: userEmail,
        mentions: allMentions.length > 0 ? allMentions : undefined,
      },
    });

    setContent("");
    setSelectedMentions([]);
    setShowMentions(false);
    setMentionFilter("");
    setMentionStartIdx(null);
  };

  const insertMention = (email: string) => {
    if (mentionStartIdx !== null && textareaRef.current) {
      const before = content.slice(0, mentionStartIdx);
      const cursor = textareaRef.current.selectionStart;
      const after = content.slice(cursor);

      const newContent = `${before}@${email} ${after}`;
      setContent(newContent);

      const newCursorPos = before.length + email.length + 2; // @ + email + space
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newCursorPos;
          textareaRef.current.selectionEnd = newCursorPos;
        }
      }, 0);
    } else {
      setContent((prev) => prev + `@${email} `);
    }

    setSelectedMentions((prev) =>
      prev.includes(email) ? prev : [...prev, email],
    );
    setShowMentions(false);
    setMentionFilter("");
    setMentionStartIdx(null);
    textareaRef.current?.focus();
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    detectMention(val, e.target.selectionStart);
  };

  const handleCursorOrSelectionChange = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    detectMention(e.currentTarget.value, e.currentTarget.selectionStart);
  };

  const detectMention = (text: string, selectionStart: number) => {
    const beforeCursor = text.slice(0, selectionStart);
    const lastAtIdx = beforeCursor.lastIndexOf("@");

    if (lastAtIdx !== -1) {
      const query = beforeCursor.slice(lastAtIdx + 1);
      // If there are no spaces or newlines in the word after @
      if (/^[^\s]*$/.test(query)) {
        setShowMentions(true);
        setMentionFilter(query);
        setMentionStartIdx(lastAtIdx);
        return;
      }
    }

    setShowMentions(false);
    setMentionFilter("");
    setMentionStartIdx(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Comments & Updates
          {comments.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {comments.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Comment list */}
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No comments yet. Be the first to post an update.
          </p>
        ) : (
          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
            {comments.map((comment) => (
              <CommentItem key={comment.comment_id} comment={comment} />
            ))}
          </div>
        )}

        {/* Comment input */}
        <div className="border-t pt-4 space-y-3">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleTextareaChange}
              onKeyUp={handleCursorOrSelectionChange}
              onSelect={handleCursorOrSelectionChange}
              onKeyDown={handleKeyDown}
              placeholder="Add a comment or update... (Type @ to mention)"
              className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
              aria-label="Comment input"
            />

            {/* Mention dropdown */}
            {showMentions && mentionFilter.length > 0 && (combinedSuggestions.length > 0 || loadingSuggestions) && (
              <div className="absolute bottom-full mb-1 left-0 w-full max-h-[150px] overflow-y-auto rounded-md border bg-popover p-1 shadow-md z-50">
                {combinedSuggestions.map((email) => (
                  <button
                    key={email}
                    type="button"
                    onClick={() => insertMention(email)}
                    className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer flex items-center justify-between"
                  >
                    <span>{email}</span>
                    {mentionablePeople.includes(email) && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        Contributor
                      </span>
                    )}
                  </button>
                ))}
                {loadingSuggestions && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground italic flex items-center gap-1.5 bg-muted/30">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                    Searching organization...
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Selected mentions */}
          {selectedMentions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedMentions.map((email) => (
                <Badge
                  key={email}
                  variant="secondary"
                  className="text-xs cursor-pointer"
                  onClick={() =>
                    setSelectedMentions((prev) =>
                      prev.filter((e) => e !== email),
                    )
                  }
                >
                  @{email} ×
                </Badge>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowMentions(!showMentions);
                  setMentionFilter("");
                }}
                aria-label="Mention someone"
              >
                <AtSign className="h-4 w-4" />
              </Button>
            </div>

            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={!content.trim() || addComment.isPending}
            >
              <Send className="h-4 w-4 mr-1" />
              {addComment.isPending ? "Posting..." : "Post"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CommentItem({ comment }: { comment: TaskComment }) {
  const initials = getInitials(comment.author_name || comment.author_email);

  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-yellow-600/20 text-yellow-600 flex items-center justify-center text-xs font-semibold">
        {initials}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium truncate">
            {comment.author_name || comment.author_email}
          </span>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">
            {formatCommentDate(comment.created_at)}
          </span>
        </div>

        <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
          {renderContentWithMentions(comment.content)}
        </p>

        {/* Attachments */}
        {comment.attachments && comment.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {comment.attachments.map((attachment, idx) => (
              <a
                key={idx}
                href={attachment.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs hover:bg-accent transition-colors"
              >
                <Paperclip className="h-3 w-3" />
                {attachment.file_name}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function buildMentionableList(
  contributors?: Array<{ email: string; share: number }>,
  ownerEmail?: string,
  currentUserEmail?: string,
): string[] {
  const emails = new Set<string>();
  if (ownerEmail) emails.add(ownerEmail);
  if (contributors) {
    for (const c of contributors) {
      emails.add(c.email);
    }
  }
  if (currentUserEmail) emails.delete(currentUserEmail);
  return Array.from(emails);
}

function getInitials(nameOrEmail: string): string {
  if (nameOrEmail.includes("@")) {
    return nameOrEmail.slice(0, 2).toUpperCase();
  }
  const parts = nameOrEmail.split(" ");
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function formatCommentDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  if (diffMins < 10080) return `${Math.floor(diffMins / 1440)}d ago`;

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function renderContentWithMentions(content: string): React.ReactNode {
  // Regex to match:
  // 1. Email-based mentions: @email@domain.com
  // 2. Name-based mentions: @username (non-spaces)
  const mentionRegex = /@([\w.+-]+(?:@[\w.-]+)?)/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Clone/reset regex index
  const regex = new RegExp(mentionRegex);

  while ((match = regex.exec(content)) !== null) {
    const matchIndex = match.index;
    const matchText = match[0];

    // Push text preceding the mention
    if (matchIndex > lastIndex) {
      parts.push(content.substring(lastIndex, matchIndex));
    }

    // Push the highlighted mention badge
    parts.push(
      <span
        key={matchIndex}
        className="font-semibold text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 px-1 py-0.5 rounded border border-yellow-500/20"
      >
        {matchText}
      </span>
    );

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.substring(lastIndex));
  }

  return parts.length > 0 ? parts : content;
}
