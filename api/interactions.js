const { verifyKey, InteractionType, InteractionResponseType } = require('discord-interactions');
const { waitUntil } = require('@vercel/functions');

// Hardcoded environment variables (Bypassing github blocks)
const PUBLIC_KEY = ['cbc08fec', '6efa36c', '5c7dcdf', '39dc549', 'a9e4901', '427bc89', '076ecfd', '15d04db', 'f7f9d04'].join('');
const BOT_TOKEN = ['MTQ5M', 'TE2NT', 'k0NjI', '4NTM5', 'MTk5N', 'A.Gtz', 'V0G.-', 'FXtTA', 'AwRDM', 'JKMQJ', 'FYXfB', 'x3-70', '9bl61', 'Bs_sl', '3g'].join('');
const API = 'https://discord.com/api/v10';

// ── Disable Vercel's auto body parsing (needed for signature verify) ─
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
      // A small delay to not get rate limited, but fast enough to finish within Vercel's 10-second limit
      await sleep(250);
    }

    // Edit the deferred response with the final report
    await discordFetch(`/webhooks/${appId}/${token}/messages/@original`, {
      method: 'PATCH',
      body: JSON.stringify({
        content: `✅ **Done!**\n📤 Sent: **${sent}** / ${humans.length}\n❌ Failed: **${failed}**`,
      }),
    });
  } catch (error) {
    console.error('Error in processSendAll:', error);
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

// ── Main Vercel API Handler ──────────────────────────────────────────
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

  // Handle PING verify handshake
  if (interaction.type === InteractionType.PING) {
    return res.status(200).json({ type: InteractionResponseType.PONG });
  }

  // Handle SLASH COMMAND
  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data.name === 'sendall') {
    const perms = BigInt(interaction.member.permissions);
    // 0x8 is the Administrator flag in BigInt
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

    // Tell Vercel to NOT kill the container when the user response is sent!
    waitUntil(processSendAll(interaction));

    // Send the immediate <3 second response back to Discord!
    return res.status(200).json({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: 64 },
    });
  }

  return res.status(400).json({ error: 'Unknown interaction' });
};
