const nacl = require('tweetnacl');

const PUBLIC_KEY = 'cbc08fec6efa36c5c7dcdf39dc549a9e4901427bc89076ecfd15d04dbf7f9d04';

function verifySignature(rawBody, signature, timestamp) {
  try {
    return nacl.sign.detached.verify(
      Buffer.from(timestamp + rawBody),
      Buffer.from(signature, 'hex'),
      Buffer.from(PUBLIC_KEY, 'hex')
    );
  } catch (err) {
    console.error('Verify error:', err);
    return false;
  }
}

// Generate a valid signature to test it
const timestamp = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify({ type: 1 });
const message = Buffer.from(timestamp + body);

// We need a dummy private key to sign and test, but here we just want to know if the verify code actually throws due to hex/buffer issues.
console.log('Testing verify setup...');
try {
  verifySignature(body, "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", timestamp);
  console.log('Function did not crash!');
} catch (e) {
  console.error('CRASH JS:', e);
}
