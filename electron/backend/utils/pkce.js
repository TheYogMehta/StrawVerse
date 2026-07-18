const crypto = require("crypto");

function getRandomValues(size) {
  try {
    return crypto.randomBytes(size);
  } catch (e) {
    const arr = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  }
}

function random(size) {
  const mask =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  let result = "";
  const randomBytesBuffer = getRandomValues(size);
  for (let i = 0; i < size; i++) {
    const randomIndex = randomBytesBuffer[i] % mask.length;
    result += mask[randomIndex];
  }
  return result;
}

function generateVerifier(length) {
  return random(length);
}

function generateChallenge(code_verifier) {
  return crypto
    .createHash("sha256")
    .update(code_verifier)
    .digest("base64")
    .replace(/\//g, "_")
    .replace(/\+/g, "-")
    .replace(/=/g, "");
}

async function pkceChallenge(length = 43) {
  if (length < 43 || length > 128) {
    throw new Error(
      `Expected a length between 43 and 128. Received ${length}.`,
    );
  }
  const verifier = generateVerifier(length);
  const challenge = generateChallenge(verifier);
  return {
    code_verifier: verifier,
    code_challenge: challenge,
  };
}

module.exports = pkceChallenge;
