import { buildApp } from "./app.js";
import { localCliUsage } from "./providers/localCliUsage.js";
const { app, config } = await buildApp();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
try {
  await app.listen({ host: config.host, port: config.port });
  // The first pass over the coding CLIs' transcripts reads a few hundred megabytes. It is
  // chunked and awaited so it never blocks the loop, but it still takes a second or two, so
  // start it here, once the port is open: the first credits request then finds it cached. Not
  // awaited, and its rejection is swallowed deliberately — a warm-up must never stop the
  // server from serving, and the route reports a read failure on its own row.
  void localCliUsage(true).catch((error) => {
    app.log.warn({ error }, "local CLI usage warm-up failed");
  });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
