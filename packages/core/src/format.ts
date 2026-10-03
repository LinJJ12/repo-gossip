import type { PlatformMessage, Tabloid } from "./types.js";

export function formatTabloid(tabloid: Tabloid): PlatformMessage {
  const { analyzed } = tabloid;
  const repo = analyzed.snapshot.fullName;
  const stars = analyzed.snapshot.stars;
  const lang = analyzed.snapshot.language ?? "unknown";

  const pulls = analyzed.snapshot.pulls?.length ?? 0;
  const issues = analyzed.snapshot.issues?.length ?? 0;
  const releases = analyzed.snapshot.releases?.length ?? 0;
  const commitCount = analyzed.snapshot.commits?.length ?? 0;
  const activityBits: string[] = [];
  if (pulls > 0) activityBits.push(`${pulls} PRs`);
  if (issues > 0) activityBits.push(`${issues} issues`);
  if (releases > 0) activityBits.push(`${releases} releases`);

  const lines: string[] = [];
  lines.push(`\uD83D\uDCF0 **\u9879\u76ee\u516b\u5366\u5c0f\u62a5 \u00b7 ${repo}**`);
  lines.push(
    `\u2B50 ${stars} \u00b7 ${lang} \u00b7 ${commitCount} commits${
      activityBits.length ? ` \u00b7 ${activityBits.join(" \u00b7 ")}` : ""
    }`,
  );
  lines.push("");
  lines.push(`\uD83C\uDFAC **\u672c\u5468\u5927\u7247**`);
  lines.push(tabloid.epicTitle);
  lines.push("");
  lines.push(`\uD83D\uDCCA **\u9879\u76ee\u4f53\u6e29**`);
  lines.push(tabloid.temperatureLine);
  lines.push("");

  if (tabloid.awardsNarrative.length) {
    lines.push(`\uD83C\uDFC6 **\u9881\u5956\u5178\u793c**`);
    for (const a of tabloid.awardsNarrative) {
      lines.push(`\u2022 ${a}`);
    }
    lines.push("");
  }

  if (tabloid.translations.length) {
    lines.push(`\uD83D\uDCAC **\u63d0\u4ea4\u4fe1\u7ffb\u8bd1**`);
    for (const t of tabloid.translations) {
      lines.push(`\u2022 \`${t.original}\``);
      lines.push(
        `  \u2192 ${t.drama}${t.author ? ` \u2014\u2014${t.author}` : ""}`,
      );
    }
    lines.push("");
  }

  if (tabloid.easterEggLines.length) {
    lines.push(`\uD83D\uDD75\uFE0F **\u5f69\u86cb\u4fa6\u63a2**`);
    for (const e of tabloid.easterEggLines) {
      lines.push(`\u2022 ${e}`);
    }
    lines.push("");
  }

  lines.push(`\uD83D\uDD6F ${tabloid.closing}`);

  const markdown = lines.join("\n");
  const plain = markdown.replace(/\*\*/g, "").replace(/`/g, "");

  return { plain, markdown };
}

export function toDiscordEmbed(tabloid: Tabloid) {
  const msg = formatTabloid(tabloid);
  const color =
    tabloid.analyzed.temperature.level === "blazing"
      ? 0xe74c3c
      : tabloid.analyzed.temperature.level === "frozen"
        ? 0x3498db
        : 0xf1c40f;

  return {
    title: tabloid.epicTitle.replace(/[\u300a\u300b]/g, "") || "repo-gossip",
    description: msg.markdown.slice(0, 4000),
    color,
    footer: {
      text: `${tabloid.analyzed.snapshot.fullName} \u00b7 repo-gossip`,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * 服务端 Key 模式下,Bot 侧不透传上游 LLM 错误细节(可能含上游响应体片段 /
 * 配额信息),统一为固定降级文案 —— 与 http-api 的 sanitizeLlmError 同口径。
 */
export function llmDegradedNote(llmError?: string): string | undefined {
  return llmError ? "LLM 暂不可用,已回落本地模板" : undefined;
}

/**
 * lark_md 会解析 `<at id=all></at>` 等标签;PR 标题 / 提交信 / LLM 输出都是
 * 攻击者可控文本,直接拼卡片可被用来 @全体成员。小报内容不含合法标签,
 * 统一剔除 at 标签并把剩余尖括号换成全角,彻底断掉标签注入。
 */
function sanitizeLarkMd(s: string): string {
  return s
    .replace(/<at[^>]*>/gi, "")
    .replace(/<\/at>/gi, "")
    .replace(/</g, "＜")
    .replace(/>/g, "＞");
}

export function toFeishuCard(tabloid: Tabloid) {
  const msg = formatTabloid(tabloid);
  return {
    msg_type: "interactive",
    card: {
      header: {
        title: {
          tag: "plain_text",
          content: `\uD83D\uDCF0 ${sanitizeLarkMd(tabloid.analyzed.snapshot.fullName)}`,
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
            content: sanitizeLarkMd(msg.markdown.slice(0, 4000)),
          },
        },
      ],
    },
  };
}
