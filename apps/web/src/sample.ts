import type { TabloidPayload } from "./types";

/** 无网络 / 限流时也能看 UI 效果 */
export const SAMPLE_TABLOID: TabloidPayload = {
  message: {
    markdown: "sample",
    plain: "sample",
  },
  tabloid: {
    epicTitle: "《深夜重构：十万行 Legacy Code 的救赎》",
    awardsNarrative: [
      "🏆「最佳卷王奖」——张三（周六凌晨 3 点提交）",
      "🧹「代码清道夫奖」——李四（删了 500 行，加了 10 行）",
    ],
    temperatureLine: "🔥「热得发烫」——近 3 天 28 次提交，距上次提交 0 天",
    translations: [
      {
        original: "fix: 修改 bug",
        drama:
          "开发者在 38°C 的高烧下，独自一人修复了导致订单支付失败的致命隐患，挽救了公司的双十一。",
        author: "张三",
      },
      {
        original: "wip",
        drama: "提交信息写了「wip」。翻译：我改了东西，但我不想解释，你自己看 diff 吧。",
        author: "王五",
      },
      {
        original: "refactor: cleanup auth",
        drama: "在无人鼓掌的舞台上，有人默默拆掉了 legacy 的承重墙：「refactor: cleanup auth」",
        author: "李四",
      },
    ],
    easterEggLines: [
      "🕵️ 有内鬼，终止交易！——赵六 @ a1b2c3d：「debug: console.log('test')」",
      "💸 技术债催收员已上门——钱七 @ d4e5f6a：「TODO: 以后再修」",
    ],
    closing: "本期八卦到此结束。仓库的秘密，比 README 诚实多了。",
    analyzed: {
      snapshot: {
        fullName: "acme/checkout",
        stars: 1337,
        language: "TypeScript",
        description: "示例仓库：支付结账服务（样报数据，非真实拉取）",
        commits: new Array(28).fill(null),
      },
      temperature: {
        level: "blazing",
        label: "热得发烫",
        emoji: "🔥",
        commitsLast3Days: 28,
        daysSinceLastCommit: 0,
      },
      awards: [
        {
          id: "night-owl",
          title: "最佳卷王奖",
          emoji: "🏆",
          winner: "张三",
          reason: "03:12 还在提交「fix: 修改 bug」",
        },
        {
          id: "cleaner",
          title: "代码清道夫奖",
          emoji: "🧹",
          winner: "李四",
          reason: "删了 500 行，只加了 10 行",
        },
        {
          id: "mvp",
          title: "本周 MVP",
          emoji: "⭐",
          winner: "张三",
          reason: "11 次提交，队友还在看戏",
        },
      ],
      easterEggs: [
        {
          tag: "有内鬼，终止交易！",
          emoji: "🕵️",
          evidence: "console.log('test')",
          sha: "a1b2c3d",
          author: "赵六",
        },
      ],
      topAuthors: [
        { name: "张三", commits: 11 },
        { name: "李四", commits: 8 },
        { name: "王五", commits: 5 },
        { name: "赵六", commits: 4 },
      ],
    },
  },
};
