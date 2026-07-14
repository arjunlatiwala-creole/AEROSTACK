import { useQuery } from '@tanstack/react-query';
import { knowledgeClient } from '@/lib/knowledgeClient';
import type { KbDefinition } from '@/lib/knowledgeClient';

export const kbKeys = {
  all: ['knowledge-bases'] as const,
  list: () => [...kbKeys.all, 'list'] as const,
} as const;

export function useKnowledgeBases(): {
  data: KbDefinition[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  return useQuery({
    queryKey: kbKeys.list(),
    queryFn: () => knowledgeClient.listKbs(),
    staleTime: 5 * 60 * 1000, // 5 minutes — KB list doesn't change often
    retry: 1,
  });
}
