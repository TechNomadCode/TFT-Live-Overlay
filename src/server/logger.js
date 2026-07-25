// Default logger used when the host process doesn't supply one. Every module
// in the server takes `log` as a dependency rather than reaching for console
// directly, so the Electron main process can route the same lines somewhere
// else without any of them knowing.

function defaultLog(level, message) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${level.padEnd(8, ' ')}] ${message}`);
}

module.exports = { defaultLog };
