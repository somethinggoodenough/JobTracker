import { existsSync, writeFileSync } from "node:fs";
import { createLocalCrawler } from "../local-crawler.mjs";

process.once("message", ({ port, key, filename }) => {
  const marker = filename + ".blocked";
  const server = createLocalCrawler({ key, filename, allow: () => true, execute: async () => {
    if (!existsSync(marker)) {
      writeFileSync(marker, new Date().toISOString());
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 45_000);
    }
    return [];
  } });
  server.listen(port, "127.0.0.1", () => process.send({ port: server.address().port }));
  process.on("disconnect", () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
});
