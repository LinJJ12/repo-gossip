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
import { runGossip, toDiscordEmbed } from "@repo-gossip/core";

export async function startDiscordBot(
  token: string,
  options?: { offline?: boolean },
) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`Discord 已上线：${c.user.tag}`);
    await registerCommands(token, c.user.id);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "gossip") return;
    await handleGossip(interaction, options?.offline);
  });

  await client.login(token);
  return client;
}

async function registerCommands(token: string, clientId: string) {
  const command = new SlashCommandBuilder()
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
        .setDescription("回溯天数（默认 14）")
        .setMinValue(1)
        .setMaxValue(90),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("offline")
        .setDescription("仅用本地模板，不调 LLM"),
    )
    .toJSON();

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), {
    body: [command],
  });
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
      `八卦失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
