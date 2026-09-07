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
