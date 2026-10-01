export type TemperatureLevel = "blazing" | "warm" | "cool" | "frozen";

export type GossipMode = "llm" | "offline" | "fallback";

export type TabloidPayload = {
  mode?: GossipMode;
  llmError?: string;
  warnings?: string[];
  tabloid: {
    epicTitle: string;
    awardsNarrative: string[];
    temperatureLine: string;
    translations: { original: string; drama: string; author: string }[];
    easterEggLines: string[];
    closing: string;
    analyzed: {
      snapshot: {
        fullName: string;
        stars: number;
        language: string | null;
        description: string | null;
        commits: {
          author: string;
          authorLogin?: string;
        }[];
      };
      temperature: {
        level: TemperatureLevel;
        label: string;
        emoji: string;
        commitsLast3Days: number;
        daysSinceLastCommit: number | null;
      };
      awards: {
        id: string;
        title: string;
        emoji: string;
        winner: string;
        reason: string;
      }[];
      easterEggs: {
        tag: string;
        emoji: string;
        evidence: string;
        sha: string;
        author: string;
      }[];
      topAuthors: { name: string; commits: number }[];
    };
  };
  message: { markdown: string; plain: string };
};

export type ScoreDimensionId =
  | "influence"
  | "activity"
  | "community"
  | "engineering"
  | "credibility";

export type ScorePayload = {
  kind: "score";
  message: { markdown: string; plain: string };
  missing: string[];
  score: {
    ref: { owner: string; repo: string };
    fullName: string;
    total: number | null;
    grade: { id: string; label: string; emoji: string } | null;
    confidence: { value: number; label: string };
    dimensions: {
      id: ScoreDimensionId;
      label: string;
      emoji: string;
      weight: number;
      score: number | null;
      lines: string[];
    }[];
    sanity: {
      id: string;
      label: string;
      level: "ok" | "warn" | "fail" | "unknown";
      detail: string;
    }[];
    watermark: {
      percent: number;
      level: "clean" | "suspicious" | "high-risk";
      notes: string[];
    };
    scoredAt: string;
  };
};

export type ComparePayload = {
  kind: "compare";
  message: { markdown: string; plain: string };
  entries: {
    repo: string;
    score: ScorePayload["score"] | null;
    error?: string;
  }[];
};
