// Lark Claude Bridge — daemon entry point.
// Boots DB, then starts the ingest pipeline (consume → filter → dedup → route).

import { migrate } from "./db/migrate.js";
import { getDb } from "./db/client.js";
import { loadConfig } from "./config/load-config.js";
import { getBotDisplayName } from "./bot/bot-identity.js";
import { filterEvent, isLarkEvent } from "./ingest/event-filter.js";
import { dedupMessage } from "./ingest/dedup.js";
import { routeMessage } from "./ingest/router.js";
import { startConsumeProcess } from "./ingest/consume-process.js";
import { reloadAgents, startWatcher, stopWatcher } from "./agents/agent-registry.js";
import { getGauges } from "./engine/index.js";
import { startStatusWriter, stopStatusWriter, markEvent } from "./ops/status-writer.js";

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`[bridge] Starting on port ${config.port}…`);

  // Run migrations on every boot (idempotent)
  migrate();

  const db = getDb();

  // Phase-05: load agents from disk into registry + start hot-reload watcher
  reloadAgents(db);
  startWatcher(db);

  const botName = getBotDisplayName();

  console.log(`[bridge] Bot display name: "${botName}"`);
  console.log(`[bridge] Starting event consumer…`);

  const handle = startConsumeProcess(
    config.lark_cli_binary,

    // onEvent: filter → dedup → route
    (raw) => {
      if (!isLarkEvent(raw)) return; // silently drop non-event objects

      const result = filterEvent(raw, botName);
      if (!result.accepted) {
        if (process.env["BRIDGE_LOG_LEVEL"] === "debug") {
          console.debug(
            `[bridge] dropped event chat_type=${raw.chat_type} msg_type=${raw.message_type}`,
          );
        }
        return;
      }

      const { event, text } = result;

      const dedup = dedupMessage(db, {
        chatId: event.chat_id,
        larkMessageId: event.message_id,
        userId: event.sender_id,
        content: event.content,
      });

      if (!dedup.isNew) {
        console.info(`[bridge] duplicate message ignored: ${event.message_id}`);
        return;
      }

      markEvent(); // update lastEventAt in status.json

      try {
        const engineCfg = {
          binary: config.engine_claude_binary,
          concurrency: config.engine_concurrency,
          timeoutMs: config.engine_timeout_ms,
          defaultModel: config.default_model,
        };
        const replyCfg = {
          binary: config.lark_cli_binary,
          maxChars: config.reply_max_chars,
        };
        routeMessage(db, {
          chatId: event.chat_id,
          userId: event.sender_id,
          text,
          larkMessageId: event.message_id,
          eventId: event.event_id,
          chatType: event.chat_type,
        }, engineCfg, replyCfg);
      } catch (err) {
        console.error(`[bridge] routing error: ${String(err)}`);
      }
    },

    // onError: log parse / spawn errors
    (err) => {
      console.error(`[bridge] ingest error: ${err.message}`);
    },
  );

  // Start status-file writer for dashboard live gauges
  startStatusWriter(getGauges);

  console.log("[bridge] Ready. Listening for Lark events…");

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      console.log(`\n[bridge] ${sig} received — shutting down…`);
      stopStatusWriter();
      stopWatcher();
      handle.stop();
      db.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error("[bridge] Fatal:", err);
  process.exit(1);
});
