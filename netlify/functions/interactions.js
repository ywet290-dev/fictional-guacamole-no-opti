const { verifyKey, InteractionType, InteractionResponseType } = require('discord-interactions');

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const signature = event.headers['x-signature-ed25519'];
  const timestamp = event.headers['x-signature-timestamp'];
  const rawBodyString = event.body;

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

    // Trigger the background function to do the heavy lifting!
    // Using event.rawUrl to dynamically get the site domain
    const host = event.headers.host;
    const protocol = host.includes('localhost') ? 'http' : 'https';
    
    // We send a POST request to our background function without awaiting it
    fetch(`${protocol}://${host}/.netlify/functions/sendall-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(interaction)
    }).catch(console.error);

    // Return IMMEDIATELY so Discord doesn't timeout!
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: 64 }, // Ephemeral message "bot is thinking..."
      })
    };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown interaction' }) };
};
