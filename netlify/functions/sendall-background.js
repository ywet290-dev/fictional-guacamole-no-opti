const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const API = 'https://discord.com/api/v10';

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

exports.handler = async function (event, context) {
  if (!event.body) return;
  const interaction = JSON.parse(event.body);

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

    // Send DMs one by one with a safe delay to bypass Discord spam-filters
    for (const member of humans) {
      const ok = await sendDM(member.user.id, embed);
      if (ok) sent++;
      else failed++;
      await sleep(600); // 0.6 seconds between DMs
    }

    // Update the original "thinking" interaction with the final success report
    await discordFetch(`/webhooks/${appId}/${token}/messages/@original`, {
      method: 'PATCH',
      body: JSON.stringify({
        content: `✅ **Done!**\n📤 Sent: **${sent}** / ${humans.length}\n❌ Failed: **${failed}**`,
      }),
    });
  } catch (error) {
    console.error('Error in sendall-background:', error);
    try {
      await discordFetch(`/webhooks/${appId}/${token}/messages/@original`, {
        method: 'PATCH',
        body: JSON.stringify({ content: `❌ Error: ${error.message}` }),
      });
    } catch (e) {
      console.error('Failed to edit reply:', e);
    }
  }
};
