// Pure Android MPV player stub (MPV player is not supported on Android)

function playInMpv() {
  throw new Error("MPV player is not supported on Android");
}

module.exports = {
  playInMpv,
};
