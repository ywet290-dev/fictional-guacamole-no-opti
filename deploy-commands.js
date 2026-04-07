const { REST, Routes, SlashCommandBuilder } = require('discord.js');

// ── Read from environment variables or config ────────────────────────
let token, clientId;
try {
  const config = require('./config.json');
  token = config.token;
  clientId = config.clientId;
} catch {
  token = process.env.DISCORD_BOT_TOKEN;
  clientId = process.env.DISCORD_CLIENT_ID;
}

if (!token || !clientId) {
  console.error('❌ Missing token or clientId!');
  console.error('   Set them in config.json or as environment variables.');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('sendall')
    .setDescription('Send a DM to every member in the server')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('The message to send (supports links)')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(0)
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('🔄 Registering slash commands globally...');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('✅ Successfully registered /sendall command!');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
})();
