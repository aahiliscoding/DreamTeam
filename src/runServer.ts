import dreamteam from "dreamteam.js";
import { NetworkConfiguration } from "dreamteam-core";
import { dreamteamNodeController } from "./controller";
import { logger } from "./utils/logger";
import { ConnectOptions } from "./types";

const networkName = process.argv[2] || "environment";
const databaseDir = process.env.dreamteam_DATABASE_DIR || ".";
const isWarpSync = process.env.IS_WARP_SYNC === "true";

// maxRetries is the maximum number of retries for retryable Ethereum
// RPC requests. maxRetries is passed to dreamteam.js's dreamteam.connect() and
// then to ethrpc library.connect(), and is used internally by ethrpc
// for both HTTP and WS transports. When an ethrpc request errors, a
// subset of errors are statically configured as retryable, in which case
// ethrpc will opaquely re-insert the RPC request at its internal queue
// head, such that dreamteam.js (and dreamteam-node) are ignorant of requests
// that eventually succeed after N retries (where N < maxRetries).
const maxRetries = process.env.MAX_REQUEST_RETRIES || 3; // default maxRetries to 3, because certain Ethereum RPC servers may frequently return transient errors and require non-zero ethrpc maxRetries to function sanely. Eg.  `geth --syncmode=light` frequently returns result "0x", signifying no data, for requests which should have data. Note that dreamteam-app bypasses this entrypoint and has its own default for MAX_REQUEST_RETRIES.

const maxSystemRetries = process.env.MAX_SYSTEM_RETRIES || "3";
const blocksPerChunk = process.env.BLOCKS_PER_CHUNK || 720;
const propagationDelayWaitMillis = process.env.DELAY_WAIT_MILLIS;
const networkConfig = NetworkConfiguration.create(networkName, false);

let config = networkConfig;
if (blocksPerChunk) config = Object.assign({}, config, { blocksPerChunk });
if (maxRetries) config = Object.assign({}, config, { maxRetries });
if (propagationDelayWaitMillis) config = Object.assign({}, config, { propagationDelayWaitMillis });
const retries: number = parseInt(maxSystemRetries || "1", 10);

function start(retries: number, config: ConnectOptions, databaseDir: string, isWarpSync: boolean) {
  const dreamteam = new dreamteam();
  const dreamteamNodeController = new dreamteamNodeController(dreamteam, config, databaseDir, isWarpSync);

  dreamteam.rpc.setDebugOptions({ broadcast: false });
  dreamteam.events.nodes.ethereum.on("disconnect", (event) => {
    logger.warn("Disconnected from Ethereum node", (event || {}).reason);
  });

  dreamteam.events.nodes.ethereum.on("reconnect", () => {
    logger.warn("Reconnect to Ethereum node");
  });

  function errorCatch(err: Error) {
    function fatalError(e: Error) {
      logger.error("Fatal Error:", e);
      process.exit(1);
    }
    if (retries > 0) {
      logger.warn(err.message);
      if (err.stack !== undefined) {
        logger.warn(err.stack);
      }
      retries--;
      dreamteamNodeController.shutdown().catch(fatalError);
      setTimeout(() => start(retries, config, databaseDir, isWarpSync), 1000);
    } else {
      fatalError(err);
    }
  }

  dreamteamNodeController.start(errorCatch).catch(errorCatch);
}

start(retries, config, databaseDir, isWarpSync);
