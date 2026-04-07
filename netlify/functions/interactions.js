const { verifyKey, InteractionType, InteractionResponseType } = require('discord-interactions');

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API = 'https://discord.com/api/v10';

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
      await sleep(600); // Netlify functions max timeout is 10s on free tier!
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

// ── Main handler (Netlify Format) ────────────────────────────────────
exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const signature = event.headers['x-signature-ed25519'];
  const timestamp = event.headers['x-signature-timestamp'];
  const rawBodyString = event.body;

  // Verify signature using official discord package
  const isValidRequest = verifyKey(rawBodyString, signature, timestamp, PUBLIC_KEY);
  if (!isValidRequest) {
    return { statusCode: 401, body: 'Bad request signature' };
  }

  const interaction = JSON.parse(rawBodyString);

  // Handle PING
  if (interaction.type === InteractionType.PING) {
    return {
      statusCode: 200,
      body: JSON.stringify({ type: InteractionResponseType.PONG })
    };
  }

  // Handle SLASH COMMAND
  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data.name === 'sendall') {
    const perms = BigInt(interaction.member.permissions);
    const ADMIN = BigInt(1 << 3);

    if (!(perms & ADMIN)) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ You need **Administrator** permission to use this command.',
            flags: 64, // Ephemeral
          },
        })
      };
    }

    // Since Netlify functions freeze when the response is returned, we can't easily do background work.
    // However, Node fetch calls may still finish if they run fast enough before the container teardown.
    // Best practice for Discord on free serverless is to Await the processSendAll, but we only have 3-10s max.
    
    // We defer reply:
    const responsePayload = {
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: 64 },
    };

    // Process DMs before exiting function if it's very small server,
    // otherwise on Netlify we have to run them in sequence to ensure they fire
    // For smaller servers this is totally fine on Netlify.
    
    // Fire it off, but we *have* to await it otherwise Netlify immediately kills the function container
    // and the DMs stop sending halfway through!
    // Since Netlify timeout is 10s, we might not reach everyone if the server is >10 people. 
    await Promise.race([
      processSendAll(interaction),
      sleep(9000) // End gracefully right before 10s timeout
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify(responsePayload)
    };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown interaction' }) };
};
