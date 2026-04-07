const { verifyKey, InteractionType, InteractionResponseType } = require('discord-interactions');

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API = 'https://discord.com/api/v10';

// ── Disable Vercel's auto body parsing to read raw bodies ────────────
module.exports.config = {
  api: { bodyParser: false },
};

// ── Read raw body from Vercel request ────────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Discord API helper ───────────────────────────────────────────────
async function discordFetch(endpoint, options = {}) {
  const res = await fetch(`${API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function fetchAllMembers(guildId) {
  let allMembers = [];
  let after = '0';
  while (true) {
    const batch = await discordFetch(`/guilds/${guildId}/members?limit=1000&after=${after}`);
    if (!batch || batch.length === 0) break;
    allMembers = allMembers.concat(batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }
  return allMembers;
}

async function sendDM(userId, embed) {
  try {
    const channel = await discordFetch('/users/@me/channels', {
      method: 'POST',
      body: JSON.stringify({ recipient_id: userId }),
    });
    await discordFetch(`/channels/${channel.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ embeds: [embed] }),
    });
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function processSendAll(interaction) {
  const guildId = interaction.guild_id;
  const message = interaction.data.options.find((o) => o.name === 'message').value;
  const senderTag = `${interaction.member.user.username}`;
  const appId = interaction.application_id;
  const token = interaction.token;

  try {
    const guild = await discordFetch(`/guilds/${guildId}`);
    const members = await fetchAllMembers(guildId);
    const humans = members.filter((m) => !m.user.bot);

    let sent = 0;
    let failed = 0;

    const embed = {
      color: 0x5865f2,
      title: `📢 Message from ${guild.name}`,
      description: message,
      footer: { text: `Sent by ${senderTag}` },
      timestamp: new Date().toISOString(),
    };

    for (const member of humans) {
      const ok = await sendDM(member.user.id, embed);
      if (ok) sent++;
      else failed++;
      await sleep(600);
    }

    await discordFetch(`/webhooks/${appId}/${token}/messages/@original`, {
      method: 'PATCH',
      body: JSON.stringify({
        content: `✅ **Done!**\n📤 Sent: **${sent}** / ${humans.length}\n❌ Failed: **${failed}**`,
      }),
    });
  } catch (error) {
    console.error('Error in /sendall:', error);
    try {
      await discordFetch(`/webhooks/${appId}/${token}/messages/@original`, {
        method: 'PATCH',
        body: JSON.stringify({ content: `❌ Error: ${error.message}` }),
      });
    } catch (e) {
      console.error('Failed to edit reply:', e);
    }
  }
}

// ── Main handler ─────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const rawBody = await getRawBody(req);
  const rawBodyString = rawBody.toString('utf8');

  // Verify signature using official discord package
  const isValidRequest = verifyKey(rawBodyString, signature, timestamp, PUBLIC_KEY);
  if (!isValidRequest) {
    return res.status(401).send('Bad request signature');
  }

  const interaction = JSON.parse(rawBodyString);

  // Handle PING
  if (interaction.type === InteractionType.PING) {
    return res.status(200).json({ type: InteractionResponseType.PONG });
  }

  // Handle SLASH COMMAND
  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data.name === 'sendall') {
    const perms = BigInt(interaction.member.permissions);
    const ADMIN = BigInt(1 << 3);

    if (!(perms & ADMIN)) {
      return res.status(200).json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ You need **Administrator** permission to use this command.',
          flags: 64, // Ephemeral
        },
      });
    }

    // Defer reply
    res.status(200).json({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: 64 },
    });

    // Process in background
    await processSendAll(interaction);
    return;
  }

  return res.status(400).json({ error: 'Unknown interaction' });
};
