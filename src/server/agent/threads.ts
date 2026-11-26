import { askMimus, type AskEvent, type AskResult } from '@/src/server/agent/ask';
import type { AiAssistantBlock, AiMessage, AiProvider } from '@/src/server/agent/providers/types';
import type { Source, ToolContext } from '@/src/server/agent/tools';
import type { SupabaseClient } from '@supabase/supabase-js';

// /ask conversation threads. Everything here runs on the asker's own
// RLS-scoped client, so the database decides whose threads exist (0030:
// only your own, and only while you're a member of the workspace).

export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
  createdAt: string;
}

export interface Thread {
  id: string;
  title: string;
  messages: ThreadMessage[];
}

// What a streaming caller sees: the thread's id first (so a new thread can
// be linked to before its answer is done), then askMimus's progress.
export type ThreadAskEvent = AskEvent | { type: 'thread'; threadId: string };

export type ThreadAskResult = Omit<AskResult, 'blocks'> & { threadId: string };

export class ThreadNotFoundError extends Error {
  constructor() {
    super('Thread not found');
  }
}

const TITLE_LENGTH = 80;
// Earlier messages replayed to the model: the last 10 turns.
const HISTORY_MESSAGES = 20;

function titleFor(question: string): string {
  const flat = question.replace(/\s+/g, ' ').trim();
  return flat.length <= TITLE_LENGTH ? flat : `${flat.slice(0, TITLE_LENGTH - 1).trimEnd()}…`;
}

export async function listThreads(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ThreadSummary[]> {
  const { data } = await supabase
    .from('ai_threads')
    .select('id, title, updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(50)
    .throwOnError();
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    updatedAt: row.updated_at as string,
  }));
}

export async function getThread(
  supabase: SupabaseClient,
  workspaceId: string,
  threadId: string,
): Promise<Thread | null> {
  const { data: thread } = await supabase
    .from('ai_threads')
    .select('id, title')
    .eq('id', threadId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
    .throwOnError();
  if (!thread) return null;
  const { data: messages } = await supabase
    .from('ai_thread_messages')
    .select('id, role, content, sources, created_at')
    .eq('thread_id', threadId)
    .order('created_at')
    .order('id')
    .throwOnError();
  return {
    id: thread.id as string,
    title: thread.title as string,
    messages: (messages ?? []).map((row) => ({
      id: row.id as string,
      role: row.role as ThreadMessage['role'],
      content: row.content as string,
      sources: (row.sources ?? []) as Source[],
      createdAt: row.created_at as string,
    })),
  };
}

// The thread so far as model history: each answered question, then its
// answer as the provider returned it. A question whose answer failed is
// left out, so the history always alternates.
async function loadHistory(supabase: SupabaseClient, threadId: string): Promise<AiMessage[]> {
  const { data } = await supabase
    .from('ai_thread_messages')
    .select('role, content, blocks')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_MESSAGES)
    .throwOnError();
  const rows = (data ?? []).reverse() as {
    role: 'user' | 'assistant';
    content: string;
    blocks: AiAssistantBlock[] | null;
  }[];
  const history: AiMessage[] = [];
  rows.forEach((row, index) => {
    if (row.role === 'user') {
      if (rows[index + 1]?.role === 'assistant') {
        history.push({ role: 'user', content: row.content });
      }
    } else if (rows[index - 1]?.role === 'user') {
      history.push({
        role: 'assistant',
        content: row.blocks?.length ? row.blocks : [{ type: 'text', text: row.content }],
      });
    }
  });
  return history;
}

// Asks a question in a thread: continues `threadId`, or starts a new thread
// titled after the question. The question is saved before the answer, so it
// stays visible (and can be asked again) if answering fails.
export async function askInThread({
  ctx,
  threadId,
  question,
  module,
  provider,
  now,
  onEvent,
}: {
  ctx: ToolContext;
  threadId?: string;
  question: string;
  module?: string;
  provider?: AiProvider;
  now?: Date;
  onEvent?: (event: ThreadAskEvent) => void;
}): Promise<ThreadAskResult> {
  const { supabase, workspaceId, userId } = ctx;

  let id: string;
  let history: AiMessage[] = [];
  if (threadId) {
    const { data: existing } = await supabase
      .from('ai_threads')
      .select('id')
      .eq('id', threadId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
      .throwOnError();
    if (!existing) throw new ThreadNotFoundError();
    id = existing.id as string;
    history = await loadHistory(supabase, id);
  } else {
    const { data: created } = await supabase
      .from('ai_threads')
      .insert({ workspace_id: workspaceId, user_id: userId, title: titleFor(question) })
      .select('id')
      .single()
      .throwOnError();
    id = created!.id as string;
  }
  onEvent?.({ type: 'thread', threadId: id });

  const message = { thread_id: id, workspace_id: workspaceId, user_id: userId };
  await supabase
    .from('ai_thread_messages')
    .insert({ ...message, role: 'user', content: question })
    .throwOnError();

  const { blocks, ...result } = await askMimus({
    ctx,
    question,
    history,
    module,
    provider,
    now,
    onEvent,
  });

  await supabase
    .from('ai_thread_messages')
    .insert({
      ...message,
      role: 'assistant',
      content: result.answer,
      blocks,
      sources: result.sources,
    })
    .throwOnError();
  await supabase
    .from('ai_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id)
    .throwOnError();

  return { ...result, threadId: id };
}
