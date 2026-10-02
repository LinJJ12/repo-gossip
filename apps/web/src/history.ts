/**
 * Web 侧历史记录门面。
 *
 * 纯逻辑单源在 apps/extension/history-logic.js(经典脚本,扩展内容脚本 /
 * service worker / web 三方共用);本文件以副作用导入它,再提供类型化 re-export
 * 与 localStorage 存取等 web 专属部分。
 */
import "../../extension/history-logic.js";

import type { GossipMode, TabloidPayload, TemperatureLevel } from "./types";

const Logic = globalThis.RepoGossipHistoryLogic;
if (!Logic) {
  throw new Error(
    "history-logic.js missing; expected classic script side-effect import",
  );
}

export const HISTORY_KEY = "repoGossipHistory";
export const DEFAULT_HISTORY_LIMIT: number = Logic.DEFAULT_LIMIT;

export type HistoryEntry = {
  repo: string;
  savedAt: number;
  mode?: string;
  epicTitle?: string;
  plain: string;
  data: TabloidPayload;
};

export const normalizeRepoKey = Logic.normalizeRepoKey as (
  repo: unknown,
) => string | null;

export const sanitizeTempLevel = Logic.sanitizeTempLevel as (
  level: unknown,
) => TemperatureLevel;

/** Prefer owner/repo; else GitHub URL; else snapshot.fullName. */
export const resolveRepoKey = Logic.resolveRepoKey as (
  input: unknown,
  data?: unknown,
) => string | null;

export const slimGossipData = Logic.slimGossipData as unknown as (
  data: unknown,
) => TabloidPayload | null;

export const normalizeHistoryList = Logic.normalizeHistoryList as (
  raw: unknown,
) => HistoryEntry[];

export const findHistoryEntry = Logic.findHistoryEntry as (
  list: HistoryEntry[],
  repo: unknown,
) => HistoryEntry | null;

export const buildHistoryEntry = Logic.buildHistoryEntry as (
  repo: string,
  data: unknown,
  savedAt?: number,
) => HistoryEntry | null;

export const upsertHistoryList = Logic.upsertHistoryList as (
  list: HistoryEntry[],
  entry: HistoryEntry | null | undefined,
  limit?: number,
) => HistoryEntry[];

export function formatSavedAt(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadHistoryFromStorage(
  storage: Pick<Storage, "getItem"> | null = getLocalStorage(),
): HistoryEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return normalizeHistoryList(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function saveHistoryToStorage(
  list: HistoryEntry[],
  storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(normalizeHistoryList(list)));
  } catch {
    // quota / private mode — ignore
  }
}

export function upsertHistoryInStorage(
  repo: string,
  data: unknown,
  storage: Pick<Storage, "getItem" | "setItem"> | null = getLocalStorage(),
): HistoryEntry[] {
  if (!storage) return [];
  const entry = buildHistoryEntry(repo, data);
  if (!entry) return loadHistoryFromStorage(storage);
  const next = upsertHistoryList(loadHistoryFromStorage(storage), entry);
  saveHistoryToStorage(next, storage);
  return next;
}

export type { GossipMode };
