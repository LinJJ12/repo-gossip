export type RepoRef = {
  owner: string;
  repo: string;
};

export type CommitStat = {
  sha: string;
  message: string;
  author: string;
  authorLogin?: string;
  date: string;
  additions: number;
  deletions: number;
  files: string[];
};

export type RepoSnapshot = {
  ref: RepoRef;
  fullName: string;
  description: string | null;
  stars: number;
  language: string | null;
  defaultBranch: string;
  commits: CommitStat[];
  fetchedAt: string;
};

export type Temperature = {
  level: "blazing" | "warm" | "cool" | "frozen";
  label: string;
  emoji: string;
  commitsLast3Days: number;
  daysSinceLastCommit: number | null;
};

export type Award = {
  id: string;
  title: string;
  emoji: string;
  winner: string;
  reason: string;
};

export type EasterEgg = {
  tag: string;
  emoji: string;
  evidence: string;
  sha: string;
  author: string;
};

export type AnalyzedGossip = {
  snapshot: RepoSnapshot;
  temperature: Temperature;
  awards: Award[];
  easterEggs: EasterEgg[];
  topAuthors: { name: string; commits: number }[];
  notableCommits: CommitStat[];
};

export type Tabloid = {
  epicTitle: string;
  awardsNarrative: string[];
  temperatureLine: string;
  translations: { original: string; drama: string; author: string }[];
  easterEggLines: string[];
  closing: string;
  analyzed: AnalyzedGossip;
};

export type PlatformMessage = {
  plain: string;
  markdown: string;
};
