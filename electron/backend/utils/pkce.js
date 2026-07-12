// TAKEN FROM : https://github.com/crouchcd/pkce-challenge

const crypto = require("crypto");

function getRandomValues(size) {
  return crypto.webcrypto.getRandomValues(new Uint8Array(size));
}

function random(size) {
  const mask =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  let result = "";
  const randomUints = getRandomValues(size);
  for (let i = 0; i < size; i++) {
    const randomIndex = randomUints[i] % mask.length;
    result += mask[randomIndex];
  }
  return result;
}

function generateVerifier(length) {
  return random(length);
}

async function generateChallenge(code_verifier) {
  const buffer = await crypto.webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code_verifier),
  );
  return Buffer.from(buffer)
    .toString("base64")
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
  const challenge = await generateChallenge(verifier);
  return {
    code_verifier: verifier,
    code_challenge: challenge,
  };
}

module.exports = pkceChallenge;
