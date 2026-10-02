import {
  Client,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  matchLooseRepo,
  parseCompareRepos,
  runCompare,
  runGossip,
  runScore,
  toDiscordEmbed,
  type ScoreLocale,
} from "@repo-gossip/core";
import { busyReplyText, consumeBotUserLimit } from "../rate-guard.js";

const MAX_DISCORD_TEXT = 2000;

export async function startDiscordBot(
  token: string,
  options?: { offline?: boolean },
) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`Discord 已上线:${c.user.tag}`);
    await registerCommands(token, c.user.id);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const guard = consumeBotUserLimit(
      interaction.user?.id ?? "unknown",
    );
    if (!guard.ok) {
      await interaction.reply(busyReplyText(guard.retryAfterSec));
      return;
    }
    if (interaction.commandName === "gossip") {
      await handleGossip(interaction, options?.offline);
    } else if (interaction.commandName === "score") {
      await handleScore(interaction);
    } else if (interaction.commandName === "compare") {
      await handleCompare(interaction);
    }
  });

  await client.login(token);
  return client;
}

async function registerCommands(token: string, clientId: string) {
  const gossip = new SlashCommandBuilder()
    .setName("gossip")
    .setDescription("生成项目八卦小报")
    .addStringOption((opt) =>
      opt
        .setName("repo")
        .setDescription("owner/repo 或 GitHub URL")
        .setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("days")
        .setDescription("回溯天数(默认 14)")
        .setMinValue(1)
        .setMaxValue(90),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("offline")
        .setDescription("仅用本地模板,不调 LLM"),
    )
    .toJSON();

  const score = new SlashCommandBuilder()
    .setName("score")
    .setDescription("含金量检定(五维评分 + 含水量)")
    .addStringOption((opt) =>
      opt
        .setName("repo")
        .setDescription("owner/repo 或 GitHub URL")
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("lang")
        .setDescription("输出语言(默认 zh)")
        .addChoices({ name: "zh", value: "zh" }, { name: "en", value: "en" }),
    )
    .toJSON();

  const compare = new SlashCommandBuilder()
    .setName("compare")
    .setDescription("多仓含金量对比(2-4 个)")
    .addStringOption((opt) =>
      opt
        .setName("repos")
        .setDescription("owner/a owner/b(空格或逗号分隔,2-4 个)")
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("lang")
        .setDescription("输出语言(默认 zh)")
        .addChoices({ name: "zh", value: "zh" }, { name: "en", value: "en" }),
    )
    .toJSON();

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), {
    body: [gossip, score, compare],
  });
}

function localeOf(interaction: ChatInputCommandInteraction): ScoreLocale {
  return (interaction.options.getString("lang") ?? "zh") === "en"
    ? "en"
    : "zh";
}

async function handleGossip(
  interaction: ChatInputCommandInteraction,
  defaultOffline?: boolean,
) {
  const repo = interaction.options.getString("repo", true);
  const days = interaction.options.getInteger("days") ?? 14;
  const offline =
    interaction.options.getBoolean("offline") ?? defaultOffline ?? false;
  await interaction.deferReply();
  try {
    const { tabloid, mode, llmError, warnings } = await runGossip({
      repo,
      offline,
      sinceDays: days,
    });
    const data = toDiscordEmbed(tabloid);
    const embed = new EmbedBuilder()
      .setTitle(data.title)
      .setDescription(data.description)
      .setColor(data.color)
      .setFooter(data.footer)
      .setTimestamp(new Date(data.timestamp));
    const notes = [
      mode !== "llm" ? `mode=${mode}` : null,
      llmError,
      ...(warnings ?? []),
    ]
      .filter(Boolean)
      .join(" · ");
    await interaction.editReply({
      content: notes || undefined,
      embeds: [embed],
    });
  } catch (err) {
    await interaction.editReply(
      `八卦失败:${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function handleScore(interaction: ChatInputCommandInteraction) {
  const repoRaw = interaction.options.getString("repo", true);
  const repo = matchLooseRepo(repoRaw) ?? repoRaw;
  const locale = localeOf(interaction);
  await interaction.deferReply();
  try {
    const { message, missing } = await runScore({ repo, locale });
    const missingNote =
      missing.length > 0 ? `\n\n⚠️ 缺失信号:${missing.join("、")}` : "";
    await interaction.editReply({
      content: message.markdown
        .slice(0, MAX_DISCORD_TEXT - missingNote.length) + missingNote,
    });
  } catch (err) {
    await interaction.editReply(
      `验金失败:${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function handleCompare(interaction: ChatInputCommandInteraction) {
  const reposRaw = interaction.options.getString("repos", true);
  const locale = localeOf(interaction);
  let repos: string[];
  try {
    repos = parseCompareRepos(reposRaw);
  } catch (err) {
    await interaction.reply(
      `${err instanceof Error ? err.message : String(err)}\n示例:/compare repos:"vercel/next.js sindresorhus/is"`,
    );
    return;
  }
  await interaction.deferReply();
  try {
    const { message } = await runCompare({ repos, locale });
    await interaction.editReply({
      content: message.markdown.slice(0, MAX_DISCORD_TEXT),
    });
  } catch (err) {
    await interaction.editReply(
      `对比失败:${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
