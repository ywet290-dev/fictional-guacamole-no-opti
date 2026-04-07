const nacl = require('tweetnacl');

// ── Config from Vercel Environment Variables ─────────────────────────
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API = 'https://discord.com/api/v10';

// ── Disable Vercel's auto body parsing (needed for signature verify) ─
module.exports.config = {
  api: { bodyParser: false },
};

// ── Read raw body from request ───────────────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Verify Discord signature ─────────────────────────────────────────
function verifySignature(rawBody, signature, timestamp) {
  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + rawBody),
      Buffer.from(signature, 'hex'),
      Buffer.from(PUBLIC_KEY, 'hex')
    );
  } catch {
    return false;
  }
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

// ── Fetch ALL guild members (handles pagination) ─────────────────────
async function fetchAllMembers(guildId) {
  let allMembers = [];
  let after = '0';

  while (true) {
    const batch = await discordFetch(
      `/guilds/${guildId}/members?limit=1000&after=${after}`
    );
    if (!batch || batch.length === 0) break;
    allMembers = allMembers.concat(batch);
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].user.id;
  }

  return allMembers;
}

// ── Send DM to a user ────────────────────────────────────────────────
async function sendDM(userId, embed) {
  try {
    // Create DM channel
    const channel = await discordFetch('/users/@me/channels', {
      method: 'POST',
      body: JSON.stringify({ recipient_id: userId }),
    });
    // Send message
    await discordFetch(`/channels/${channel.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ embeds: [embed] }),
    });
    return true;
  } catch {
    return false;
  }
}

// ── Small delay helper ───────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Process /sendall in background ───────────────────────────────────
async function processSendAll(interaction) {
  const guildId = interaction.guild_id;
  const message = interaction.data.options.find((o) => o.name === 'message').value;
  const senderTag = `${interaction.member.user.username}`;
  const appId = interaction.application_id;
  const token = interaction.token;

  try {
    // Fetch guild info for the embed title
    const guild = await discordFetch(`/guilds/${guildId}`);

    // Fetch all members
    const members = await fetchAllMembers(guildId);
    const humans = members.filter((m) => !m.user.bot);

    let sent = 0;
    let failed = 0;

    // Build embed
    const embed = {
      color: 0x5865f2,
      title: `📢 Message from ${guild.name}`,
      description: message,
      footer: { text: `Sent by ${senderTag}` },
      timestamp: new Date().toISOString(),
    };

    // Send DMs with rate-limit delay
    for (const member of humans) {
      const ok = await sendDM(member.user.id, embed);
      if (ok) sent++;
      else failed++;
      await sleep(600);
    }

    // Edit the deferred reply with results
    await discordFetch(
      `/webhooks/${appId}/${token}/messages/@original`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          content: [
            `✅ **Done!**`,
            `📤 Sent: **${sent}** / ${humans.length}`,
            `❌ Failed: **${failed}**`,
          ].join('\n'),
        }),
      }
    );
  } catch (error) {
    console.error('Error in /sendall:', error);
    try {
      await discordFetch(
        `/webhooks/${appId}/${token}/messages/@original`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            content: `❌ Error: ${error.message}`,
          }),
        }
      );
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

  // 1. Read & verify signature
  const rawBody = await getRawBody(req);
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];

  if (!signature || !timestamp || !verifySignature(rawBody.toString(), signature, timestamp)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const interaction = JSON.parse(rawBody.toString());

  // 2. Handle PING (Discord verification handshake)
  if (interaction.type === 1) {
    return res.status(200).json({ type: 1 });
  }

  // 3. Handle slash commands
  if (interaction.type === 2 && interaction.data.name === 'sendall') {
    // Check admin permissions
    const perms = BigInt(interaction.member.permissions);
    const ADMIN = BigInt(1 << 3);

    if (!(perms & ADMIN)) {
      return res.status(200).json({
        type: 4,
        data: {
          content: '❌ You need **Administrator** permission to use this command.',
          flags: 64,
        },
      });
    }

    // Defer reply (ephemeral) — tells Discord "I'm working on it"
    res.status(200).json({
      type: 5,
      data: { flags: 64 },
    });

    // Process in background (Vercel keeps function alive after res.json)
    await processSendAll(interaction);
    return;
  }

  // Unknown interaction
  return res.status(400).json({ error: 'Unknown interaction' });
};
