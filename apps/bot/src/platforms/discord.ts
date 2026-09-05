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
    .toJSON();

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), {
    body: [command],
  });
}

async function handleGossip(
  interaction: ChatInputCommandInteraction,
  offline?: boolean,
) {
  const repo = interaction.options.getString("repo", true);
  await interaction.deferReply();
  try {
    const { tabloid } = await runGossip({ repo, offline });
    const data = toDiscordEmbed(tabloid);
    const embed = new EmbedBuilder()
      .setTitle(data.title)
      .setDescription(data.description)
      .setColor(data.color)
      .setFooter(data.footer)
      .setTimestamp(new Date(data.timestamp));
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply(
      `八卦失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
