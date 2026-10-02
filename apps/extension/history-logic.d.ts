/**
 * Type declarations for the classic-script history-logic.js (single source of
 * history logic shared by the web app and the extension).
 */

export {};

interface RepoGossipHistoryLogicAPI {
  readonly DEFAULT_LIMIT: number;
  normalizeRepoKey(repo: unknown): string | null;
  resolveRepoKey(
    input: unknown,
    data?: unknown,
  ): string | null;
  sanitizeTempLevel(
    level: unknown,
  ): "blazing" | "warm" | "cool" | "frozen";
  normalizeHistoryList(raw: unknown): any[];
  findHistoryEntry(list: any[], repo: unknown): any | null;
  slimGossipData(data: unknown): object | null;
  buildHistoryEntry(
    repo: string,
    data: unknown,
    savedAt?: number,
  ): object | null;
  upsertHistoryList(list: any[], entry: unknown, limit?: number): any[];
}

declare global {
  var RepoGossipHistoryLogic: RepoGossipHistoryLogicAPI | undefined;
}
