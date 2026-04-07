const {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { token } = require('./config.json');

// ── Create the client with required intents ──────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // REQUIRED — must be enabled in Developer Portal
  ],
});

// ── Bot ready ────────────────────────────────────────────────────────
client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);
  console.log(`📡 Serving ${readyClient.guilds.cache.size} server(s)`);
});

// ── Error handling ───────────────────────────────────────────────────
client.on(Events.Error, (error) => {
  console.error('❌ Client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
});

// ── Handle /sendall ──────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'sendall') return;

  // Permission check — only admins can use this
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: '❌ You need **Administrator** permission to use this command.',
      ephemeral: true,
    });
  }

  const messageContent = interaction.options.getString('message');
  const guild = interaction.guild;

  // Acknowledge immediately so Discord doesn't time out
  await interaction.deferReply({ ephemeral: true });

  try {
    // Fetch all members (requires GuildMembers intent + privileged intent enabled)
    const members = await guild.members.fetch();

    // Filter out bots
    const humans = members.filter((m) => !m.user.bot);

    let sent = 0;
    let failed = 0;
    const failedUsers = [];

    // Build a nice embed for the DM
    const embed = new EmbedBuilder()
      .setColor(0x5865f2) // Discord blurple
      .setTitle(`📢 Message from ${guild.name}`)
      .setDescription(messageContent)
      .setFooter({ text: `Sent by ${interaction.user.tag}` })
      .setTimestamp();

    for (const [, member] of humans) {
      try {
        await member.send({ embeds: [embed] });
        sent++;
      } catch {
        // User has DMs closed or bot is blocked
        failed++;
        failedUsers.push(member.user.tag);
      }

      // Small delay to avoid rate limits (1 DM per 500ms)
      await sleep(500);
    }

    // Report results back to the admin
    const report = [
      `✅ **Done!**`,
      `📤 Sent: **${sent}** / ${humans.size}`,
      `❌ Failed: **${failed}**${failed > 0 ? ` (${failedUsers.slice(0, 10).join(', ')}${failedUsers.length > 10 ? '...' : ''})` : ''}`,
    ].join('\n');

    await interaction.editReply({ content: report });
  } catch (error) {
    console.error('Error in /sendall:', error);
    await interaction.editReply({
      content: '❌ Something went wrong while sending messages. Check the console.',
    });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Login ────────────────────────────────────────────────────────────
client.login(token);
