import type { PlatformMessage, Tabloid } from "../types.js";

export function formatTabloid(tabloid: Tabloid): PlatformMessage {
  const { analyzed } = tabloid;
  const repo = analyzed.snapshot.fullName;
  const stars = analyzed.snapshot.stars;
  const lang = analyzed.snapshot.language ?? "未知语言";

  const lines: string[] = [];
  lines.push(`📰 **项目八卦小报 · ${repo}**`);
  lines.push(`⭐ ${stars} · 🗣️ ${lang} · 📦 近两周 ${analyzed.snapshot.commits.length} 次提交`);
  lines.push("");
  lines.push(`🎬 **本周大片**`);
  lines.push(tabloid.epicTitle);
  lines.push("");
  lines.push(`📊 **项目体温**`);
  lines.push(tabloid.temperatureLine);
  lines.push("");

  if (tabloid.awardsNarrative.length) {
    lines.push(`🏆 **颁奖典礼**`);
    for (const a of tabloid.awardsNarrative) {
      lines.push(`• ${a}`);
    }
    lines.push("");
  }

  if (tabloid.translations.length) {
    lines.push(`💬 **提交信翻译**`);
    for (const t of tabloid.translations) {
      lines.push(`• \`${t.original}\``);
      lines.push(`  → ${t.drama}${t.author ? ` ——${t.author}` : ""}`);
    }
    lines.push("");
  }

  if (tabloid.easterEggLines.length) {
    lines.push(`🕵️ **彩蛋侦探**`);
    for (const e of tabloid.easterEggLines) {
      lines.push(`• ${e}`);
    }
    lines.push("");
  }

  lines.push(`🕯️ ${tabloid.closing}`);

  const markdown = lines.join("\n");
  const plain = markdown
    .replace(/\*\*/g, "")
    .replace(/`/g, "");

  return { plain, markdown };
}

/** Discord Embed 结构（不依赖 discord.js 类型，方便 Serverless） */
export function toDiscordEmbed(tabloid: Tabloid) {
  const msg = formatTabloid(tabloid);
  const color =
    tabloid.analyzed.temperature.level === "blazing"
      ? 0xe74c3c
      : tabloid.analyzed.temperature.level === "frozen"
        ? 0x3498db
        : 0xf1c40f;

  return {
    title: tabloid.epicTitle.replace(/[《》]/g, "") || "项目八卦小报",
    description: msg.markdown.slice(0, 4000),
    color,
    footer: {
      text: `${tabloid.analyzed.snapshot.fullName} · repo-gossip`,
    },
    timestamp: new Date().toISOString(),
  };
}

/** 飞书互动卡片 */
export function toFeishuCard(tabloid: Tabloid) {
  const msg = formatTabloid(tabloid);
  return {
    msg_type: "interactive",
    card: {
      header: {
        title: {
          tag: "plain_text",
          content: `📰 ${tabloid.analyzed.snapshot.fullName} 八卦小报`,
        },
        template:
          tabloid.analyzed.temperature.level === "blazing"
            ? "red"
            : tabloid.analyzed.temperature.level === "frozen"
              ? "blue"
              : "orange",
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: msg.markdown.slice(0, 4000),
          },
        },
      ],
    },
  };
}
