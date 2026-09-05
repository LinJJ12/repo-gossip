import type {
  AnalyzedGossip,
  Award,
  CommitStat,
  EasterEgg,
  RepoSnapshot,
  Temperature,
} from "../types.js";

const EGG_PATTERNS: {
  re: RegExp;
  tag: string;
  emoji: string;
}[] = [
  {
    re: /console\.log\s*\(\s*['"`]?(?:test|debug|todo|wtf|aaa+|here)/i,
    tag: "有内鬼，终止交易！",
    emoji: "🕵️",
  },
  {
    re: /\bTODO\b|\bFIXME\b|\bHACK\b/,
    tag: "技术债催收员已上门",
    emoji: "💸",
  },
  {
    re: /\bpassword\s*=\s*['"][^'"]+['"]|\bapi[_-]?key\s*=\s*['"][^'"]+['"]/i,
    tag: "密钥裸奔现场",
    emoji: "🚨",
  },
  {
    re: /\bany\b|as unknown as|@ts-ignore|eslint-disable/i,
    tag: "类型系统已投降",
    emoji: "🏳️",
  },
  {
    re: /fuck|shit|wtf|草泥马|卧槽|妈的/i,
    tag: "提交信息带脏字（情绪真挚）",
    emoji: "🤬",
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
      label: "已凉",
      emoji: "🥶",
      commitsLast3Days,
      daysSinceLastCommit,
    };
  }
  if (commitsLast3Days > 20) {
    return {
      level: "blazing",
      label: "热得发烫",
      emoji: "🔥",
      commitsLast3Days,
      daysSinceLastCommit,
    };
  }
  if (commitsLast3Days >= 5) {
    return {
      level: "warm",
      label: "微微出汗",
      emoji: "🌡️",
      commitsLast3Days,
      daysSinceLastCommit,
    };
  }
  if (commitsLast3Days >= 1 || (daysSinceLastCommit !== null && daysSinceLastCommit < 7)) {
    return {
      level: "cool",
      label: "还在喘气",
      emoji: "😮‍💨",
      commitsLast3Days,
      daysSinceLastCommit,
    };
  }
  return {
    level: "frozen",
    label: "已凉",
    emoji: "🥶",
    commitsLast3Days,
    daysSinceLastCommit,
  };
}

function calcAwards(commits: CommitStat[]): Award[] {
  if (commits.length === 0) return [];

  const awards: Award[] = [];

  const nightOwl = commits
    .map((c) => ({ c, hour: new Date(c.date).getHours() }))
    .filter(({ hour }) => hour >= 0 && hour < 5)
    .sort((a, b) => a.hour - b.hour)[0];
  if (nightOwl) {
    const h = new Date(nightOwl.c.date).getHours();
    const m = new Date(nightOwl.c.date).getMinutes();
    awards.push({
      id: "night-owl",
      title: "最佳卷王奖",
      emoji: "🏆",
      winner: nightOwl.c.author,
      reason: `${pad(h)}:${pad(m)} 还在提交「${truncate(nightOwl.c.message, 40)}」`,
    });
  }

  const cleaner = [...commits].sort(
    (a, b) => b.deletions - b.additions - (a.deletions - a.additions),
  )[0];
  if (cleaner && cleaner.deletions > cleaner.additions && cleaner.deletions >= 20) {
    awards.push({
      id: "cleaner",
      title: "代码清道夫奖",
      emoji: "🧹",
      winner: cleaner.author,
      reason: `删了 ${cleaner.deletions} 行，只加了 ${cleaner.additions} 行`,
    });
  }

  const dumpTruck = [...commits].sort(
    (a, b) => b.additions + b.deletions - (a.additions + a.deletions),
  )[0];
  if (dumpTruck && dumpTruck.additions + dumpTruck.deletions >= 200) {
    awards.push({
      id: "dump-truck",
      title: "拆迁办特别奖",
      emoji: "🏗️",
      winner: dumpTruck.author,
      reason: `单次提交狂改 ${dumpTruck.additions + dumpTruck.deletions} 行`,
    });
  }

  const byCount = rankAuthors(commits);
  if (byCount[0] && byCount[0].commits >= 3) {
    awards.push({
      id: "mvp",
      title: "本周 MVP",
      emoji: "⭐",
      winner: byCount[0].name,
      reason: `${byCount[0].commits} 次提交，队友还在看戏`,
    });
  }

  const oneLiners = commits.filter(
    (c) =>
      /^(fix|wip|tmp|misc|changes?|update|小改|改了下|修好了|测试一下)\s*$/i.test(
        c.message,
      ) ||
      /^(fix|chore|update):\s*(bug)?\s*$/i.test(c.message) ||
      c.message.length <= 8,
  );
  if (oneLiners[0]) {
    awards.push({
      id: "vague",
      title: "废话文学金句奖",
      emoji: "💬",
      winner: oneLiners[0].author,
      reason: `原文：「${oneLiners[0].message}」—— 信息量约等于零`,
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
  // 文件名含 debug 且提交信息很水，才算「有内鬼」
  if (
    /console\.log/.test(c.message) ||
    (c.files.some((f) => /debug/i.test(f)) &&
      /^(fix|wip|test|tmp|misc)\b/i.test(c.message))
  ) {
      if (!eggs.some((e) => e.sha === c.sha)) {
        eggs.push({
          tag: "有内鬼，终止交易！",
          emoji: "🕵️",
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
      (/fix|bug|hotfix|urgent|紧急|救命/i.test(c.message) ? 4 : 0) +
      (new Date(c.date).getHours() < 5 ? 2 : 0),
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
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
