import type {
  AnalyzedGossip,
  Award,
  CommitStat,
  EasterEgg,
  RepoSnapshot,
  Temperature,
} from "./types.js";

const EGG_PATTERNS: {
  re: RegExp;
  tag: string;
  emoji: string;
}[] = [
  {
    re: /console\.log\s*\(\s*['"`]?(?:test|debug|todo|wtf|aaa+|here)/i,
    tag: "\u6709\u5185\u9b3c\uff0c\u7ec8\u6b62\u4ea4\u6613\uff01",
    emoji: "\uD83D\uDD75\uFE0F",
  },
  {
    re: /\bTODO\b|\bFIXME\b|\bHACK\b/,
    tag: "\u6280\u672f\u503a\u50ac\u6536\u5458\u5df2\u4e0a\u95e8",
    emoji: "\uD83D\uDCB8",
  },
  {
    re: /\bpassword\s*=\s*['"][^'"]+['"]|\bapi[_-]?key\s*=\s*['"][^'"]+['"]/i,
    tag: "\u5bc6\u94a5\u88f8\u5954\u73b0\u573a",
    emoji: "\uD83D\uDEA8",
  },
  {
    re: /\bas unknown as\b|@ts-ignore|eslint-disable/i,
    tag: "\u7c7b\u578b\u7cfb\u7edf\u5df2\u6295\u964d",
    emoji: "\uD83C\uDFF3\uFE0F",
  },
  {
    re: /fuck|shit|wtf/i,
    tag: "\u63d0\u4ea4\u4fe1\u606f\u5e26\u810f\u5b57",
    emoji: "\uD83E\uDD2C",
  },
];

export function analyzeSnapshot(snapshot: RepoSnapshot): AnalyzedGossip {
  const commits = [...snapshot.commits].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return {
    snapshot,
    temperature: calcTemperature(commits),
    awards: calcAwards(commits),
    easterEggs: findEasterEggs(commits),
    topAuthors: rankAuthors(commits),
    notableCommits: pickNotable(commits),
  };
}

function calcTemperature(commits: CommitStat[]): Temperature {
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const commitsLast3Days = commits.filter(
    (c) => now - new Date(c.date).getTime() <= threeDays,
  ).length;

  const last = commits[0];
  const daysSinceLastCommit = last
    ? Math.floor((now - new Date(last.date).getTime()) / (24 * 60 * 60 * 1000))
    : null;

  if (daysSinceLastCommit !== null && daysSinceLastCommit >= 14) {
    return {
      level: "frozen",
      label: "\u5df2\u51c9",
      emoji: "\uD83E\uDD76",
      commitsLast3Days,
      daysSinceLastCommit,
    };
  }
  if (commitsLast3Days > 20) {
    return {
      level: "blazing",
      label: "\u70ed\u5f97\u53d1\u70eb",
      emoji: "\uD83D\uDD25",
      commitsLast3Days,
      daysSinceLastCommit,
    };
  }
  if (commitsLast3Days >= 5) {
    return {
      level: "warm",
      label: "\u5fae\u5fae\u51fa\u6c57",
      emoji: "\uD83C\uDF21\uFE0F",
      commitsLast3Days,
      daysSinceLastCommit,
    };
  }
  if (
    commitsLast3Days >= 1 ||
    (daysSinceLastCommit !== null && daysSinceLastCommit < 7)
  ) {
    return {
      level: "cool",
      label: "\u8fd8\u5728\u5598\u6c14",
      emoji: "\uD83D\uDE2E\u200D\uD83D\uDCA8",
      commitsLast3Days,
      daysSinceLastCommit,
    };
  }
  return {
    level: "frozen",
    label: "\u5df2\u51c9",
    emoji: "\uD83E\uDD76",
    commitsLast3Days,
    daysSinceLastCommit,
  };
}

function calcAwards(commits: CommitStat[]): Award[] {
  if (commits.length === 0) return [];

  const awards: Award[] = [];

  const nightOwl = commits
    .map((c) => ({ c, hour: new Date(c.date).getUTCHours() }))
    .filter(({ hour }) => hour >= 0 && hour < 5)
    .sort((a, b) => a.hour - b.hour)[0];
  if (nightOwl) {
    const h = new Date(nightOwl.c.date).getUTCHours();
    const m = new Date(nightOwl.c.date).getUTCMinutes();
    awards.push({
      id: "night-owl",
      title: "\u6700\u4f73\u5377\u738b\u5956",
      emoji: "\uD83C\uDFC6",
      winner: nightOwl.c.author,
      reason: `${pad(h)}:${pad(m)} UTC still shipping \u300c${truncate(nightOwl.c.message, 40)}\u300d`,
    });
  }

  const cleaner = [...commits].sort(
    (a, b) => b.deletions - b.additions - (a.deletions - a.additions),
  )[0];
  if (cleaner && cleaner.deletions > cleaner.additions && cleaner.deletions >= 20) {
    awards.push({
      id: "cleaner",
      title: "\u4ee3\u7801\u6e05\u9053\u592b\u5956",
      emoji: "\uD83E\uDDF9",
      winner: cleaner.author,
      reason: `-${cleaner.deletions} / +${cleaner.additions}`,
    });
  }

  const dumpTruck = [...commits].sort(
    (a, b) => b.additions + b.deletions - (a.additions + a.deletions),
  )[0];
  if (dumpTruck && dumpTruck.additions + dumpTruck.deletions >= 200) {
    awards.push({
      id: "dump-truck",
      title: "\u62c6\u8fc1\u529e\u7279\u522b\u5956",
      emoji: "\uD83C\uDFD7\uFE0F",
      winner: dumpTruck.author,
      reason: `${dumpTruck.additions + dumpTruck.deletions} LOC touched`,
    });
  }

  const byCount = rankAuthors(commits);
  if (byCount[0] && byCount[0].commits >= 3) {
    awards.push({
      id: "mvp",
      title: "\u672c\u5468 MVP",
      emoji: "\u2B50",
      winner: byCount[0].name,
      reason: `${byCount[0].commits} commits`,
    });
  }

  const oneLiners = commits.filter(
    (c) =>
      /^(fix|wip|tmp|misc|changes?|update)\s*$/i.test(c.message) ||
      /^(fix|chore|update):\s*(bug)?\s*$/i.test(c.message) ||
      c.message.length <= 8,
  );
  if (oneLiners[0]) {
    awards.push({
      id: "vague",
      title: "\u5e9f\u8bdd\u6587\u5b66\u91d1\u53e5\u5956",
      emoji: "\uD83D\uDCAC",
      winner: oneLiners[0].author,
      reason: `\u300c${oneLiners[0].message}\u300d`,
    });
  }

  return awards.slice(0, 5);
}

function findEasterEggs(commits: CommitStat[]): EasterEgg[] {
  const eggs: EasterEgg[] = [];
  for (const c of commits) {
    const haystack = [c.message, ...c.files].join("\n");
    for (const p of EGG_PATTERNS) {
      if (p.re.test(haystack) || p.re.test(c.message)) {
        eggs.push({
          tag: p.tag,
          emoji: p.emoji,
          evidence: truncate(c.message, 60),
          sha: c.sha,
          author: c.author,
        });
        break;
      }
    }
    if (
      /console\.log/.test(c.message) ||
      (c.files.some((f) => /debug/i.test(f)) &&
        /^(fix|wip|test|tmp|misc)\b/i.test(c.message))
    ) {
      if (!eggs.some((e) => e.sha === c.sha)) {
        eggs.push({
          tag: "\u6709\u5185\u9b3c\uff0c\u7ec8\u6b62\u4ea4\u6613\uff01",
          emoji: "\uD83D\uDD75\uFE0F",
          evidence: truncate(c.message, 60),
          sha: c.sha,
          author: c.author,
        });
      }
    }
  }
  return eggs.slice(0, 5);
}

function rankAuthors(commits: CommitStat[]) {
  const map = new Map<string, number>();
  for (const c of commits) {
    map.set(c.author, (map.get(c.author) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, n]) => ({ name, commits: n }))
    .sort((a, b) => b.commits - a.commits);
}

function pickNotable(commits: CommitStat[]): CommitStat[] {
  const scored = commits.map((c) => ({
    c,
    score:
      (c.additions + c.deletions) / 50 +
      (c.message.length < 12 ? 3 : 0) +
      (/fix|bug|hotfix|urgent/i.test(c.message) ? 4 : 0) +
      (new Date(c.date).getUTCHours() < 5 ? 2 : 0),
  }));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.c);
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}\u2026`;
}
