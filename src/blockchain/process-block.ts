import * as _ from "lodash";
import * as Knex from "knex";
import { each } from "bluebird";
import dreamteam, { FormattedEventLog } from "dreamteam.js";
import { dreamteamEmitter } from "../events";
import { BlockDetail, BlocksRow, MarketsContractAddressRow, ReportingState, Address, FeeWindowState, MarketIdUniverseFeeWindow, TransactionHashesRow } from "../types";
import { updateActiveFeeWindows, updateMarketState } from "./log-processors/database";
import { getMarketsWithReportingState } from "../server/getters/database";
import { logger } from "../utils/logger";
import { SubscriptionEventNames, DB_VERSION, DB_FILE, DB_WARP_SYNC_FILE, DUMP_EVERY_BLOCKS } from "../constants";
import { processLogByName } from "./process-logs";
import { BackupRestore } from "../sync/backup-restore";
import { checkOrphanedOrders } from "./check-orphaned-orders";
import { checkMarketLiquidityUpdates } from "./check-market-liquidity-updates";

export type BlockDirection = "add" | "remove";

const overrideTimestamps = Array<number>();
let blockHeadTimestamp: number = 0;

export function getCurrentTime(): number {
  return getOverrideTimestamp() || blockHeadTimestamp;
}

export async function setOverrideTimestamp(db: Knex, overrideTimestamp: number) {
  overrideTimestamps.push(overrideTimestamp);
  return db("network_id").update("overrideTimestamp", overrideTimestamp);
}

export async function removeOverrideTimestamp(db: Knex, overrideTimestamp: number) {
  const removedTimestamp = overrideTimestamps.pop();
  const priorTimestamp = getOverrideTimestamp();
  if (removedTimestamp !== overrideTimestamp || priorTimestamp == null) {
    throw new Error(`Timestamp removal failed ${removedTimestamp} ${overrideTimestamp}`);
  }
  return db("network_id").update("overrideTimestamp", priorTimestamp);
}

export function getOverrideTimestamp(): number | null {
  if (overrideTimestamps.length === 0) return null;
  return overrideTimestamps[overrideTimestamps.length - 1];
}

export function clearOverrideTimestamp(): void {
  overrideTimestamps.splice(0, overrideTimestamps.length);
  blockHeadTimestamp = 0;
}

export async function processBlockAndLogs(db: Knex, dreamteam: dreamteam, direction: BlockDirection, block: BlockDetail, bulkSync: boolean, logs: Array<FormattedEventLog>, databaseDir: string, isWarpSync: boolean) {
  if (!block || !block.timestamp) throw new Error(JSON.stringify(block));
  const dbWritePromises = _.compact(logs.map((log) => processLogByName(dreamteam, log, true)));
  const dbWriteFunctions = await Promise.all(dbWritePromises);
  const dbWritesFunction = async (db: Knex) => {
    if (dbWriteFunctions.length > 0) logger.info(`Processing ${dbWritePromises.length} logs`);
    for (const dbWriteFunction of dbWriteFunctions) {
      if (dbWriteFunction != null) await dbWriteFunction(db);
    }
  };
  await db.transaction(async (trx: Knex.Transaction) => {
    if (direction === "add") {
      await processBlockByBlockDetails(trx, dreamteam, block, bulkSync);
      await dbWritesFunction(trx);
    } else {
      logger.info(`block removed: ${parseInt(block.number, 16)} (${block.hash})`);
      await dbWritesFunction(trx);
      await db("transactionHashes")
        .transacting(trx)
        .where({ blockNumber: parseInt(block.number, 16) })
        .update({ removed: 1 });
      await db("blocks").transacting(trx).where({ blockHash: block.hash }).del();
      // TODO: un-advance time
    }
  });
  await checkOrphanedOrders(db, dreamteam);
  await checkMarketLiquidityUpdates(db);
  try {
    if (isWarpSync && parseInt(block.number, 16) % DUMP_EVERY_BLOCKS === 0) {
      // every X blocks export db to warp file.
      const networkId: string = dreamteam.rpc.getNetworkID();
      await BackupRestore.export(DB_FILE, networkId, DB_VERSION, DB_WARP_SYNC_FILE, databaseDir);
    }
  } catch (err) {
    logger.error("ERROR: could not create warp sync file");
  }
}

async function insertBlockRow(db: Knex, blockNumber: number, blockHash: string, bulkSync: boolean, timestamp: number) {
  const blocksRows: Array<BlocksRow> = await db("blocks").where({ blockNumber });
  let query: Knex.QueryBuilder;
  if (!blocksRows || !blocksRows.length) {
    query = db.insert({ blockNumber, blockHash, timestamp, bulkSync }).into("blocks");
  } else {
    query = db("blocks").where({ blockNumber }).update({ blockHash, timestamp, bulkSync });
  }
  return query;
}

export async function processBlockByBlockDetails(db: Knex, dreamteam: dreamteam, block: BlockDetail, bulkSync: boolean) {
  if (!block || !block.timestamp) throw new Error(JSON.stringify(block));
  const blockNumber = parseInt(block.number, 16);
  const blockHash = block.hash;
  blockHeadTimestamp = parseInt(block.timestamp, 16);
  const timestamp = getOverrideTimestamp() || blockHeadTimestamp;
  logger.info("new block:", `${blockNumber}, ${timestamp} (${new Date(timestamp * 1000).toString()})`);
  await insertBlockRow(db, blockNumber, blockHash, bulkSync, timestamp);
  await advanceTime(db, dreamteam, blockNumber, timestamp);
}

export async function insertTransactionHash(db: Knex, blockNumber: number, transactionHash: string) {
  if (transactionHash === null) throw new Error("Received null transactionHash from getLogs request. Your Ethereum node might be in light mode with bug: https://github.com/paritytech/parity-ethereum/issues/9929");
  const txHashRows: Array<TransactionHashesRow> = await db("transactionHashes").where({ transactionHash });
  if (!txHashRows || !txHashRows.length) {
    await db.insert({ blockNumber, transactionHash }).into("transactionHashes");
  }
}

async function advanceTime(db: Knex, dreamteam: dreamteam, blockNumber: number, timestamp: number) {
  await advanceMarketReachingEndTime(db, dreamteam, blockNumber, timestamp);
  await advanceMarketMissingDesignatedReport(db, dreamteam, blockNumber, timestamp);
  await advanceFeeWindowActive(db, dreamteam, blockNumber, timestamp);
}

async function advanceMarketReachingEndTime(db: Knex, dreamteam: dreamteam, blockNumber: number, timestamp: number) {
  const networkId: string = dreamteam.rpc.getNetworkID();
  const universe: string = dreamteam.contracts.addresses[networkId].Universe;
  const designatedDisputeQuery = db("markets").select("markets.marketId").join("market_state", "market_state.marketStateId", "markets.marketStateId");
  designatedDisputeQuery.where("reportingState", dreamteam.constants.REPORTING_STATE.PRE_REPORTING).where("endTime", "<", timestamp);
  const designatedDisputeMarketIds: Array<MarketsContractAddressRow> = await designatedDisputeQuery;
  await each(designatedDisputeMarketIds, async (marketIdRow) => {
    await updateMarketState(db, marketIdRow.marketId, blockNumber, dreamteam.constants.REPORTING_STATE.DESIGNATED_REPORTING);
    dreamteamEmitter.emit(SubscriptionEventNames.MarketState, {
      universe,
      marketId: marketIdRow.marketId,
      reportingState: dreamteam.constants.REPORTING_STATE.DESIGNATED_REPORTING,
    });
  });
}

async function advanceMarketMissingDesignatedReport(db: Knex, dreamteam: dreamteam, blockNumber: number, timestamp: number) {
  const networkId: string = dreamteam.rpc.getNetworkID();
  const universe: string = dreamteam.contracts.addresses[networkId].Universe;
  const marketsMissingDesignatedReport = getMarketsWithReportingState(db, ["markets.marketId"])
    .where("endTime", "<", timestamp - dreamteam.constants.CONTRACT_INTERVAL.DESIGNATED_REPORTING_DURATION_SECONDS)
    .where("reportingState", dreamteam.constants.REPORTING_STATE.DESIGNATED_REPORTING);
  const marketAddressRows: Array<MarketsContractAddressRow> = await marketsMissingDesignatedReport;
  await each(marketAddressRows, async (marketIdRow) => {
    await updateMarketState(db, marketIdRow.marketId, blockNumber, dreamteam.constants.REPORTING_STATE.OPEN_REPORTING);
    dreamteamEmitter.emit(SubscriptionEventNames.MarketState, {
      universe,
      marketId: marketIdRow.marketId,
      reportingState: dreamteam.constants.REPORTING_STATE.OPEN_REPORTING,
    });
  });
}

async function advanceMarketsToAwaitingFinalization(db: Knex, dreamteam: dreamteam, blockNumber: number, expiredFeeWindows: Array<Address>) {
  const marketIds: Array<{ marketId: Address; universe: Address }> = await getMarketsWithReportingState(db, ["markets.marketId", "markets.universe"])
    .join("universes", "markets.universe", "universes.universe")
    .where("universes.forked", 0)
    .whereIn("markets.feeWindow", expiredFeeWindows)
    .whereNot("markets.needsMigration", 1)
    .whereNot("markets.forking", 1);

  await each(marketIds, async (marketIdRow) => {
    await updateMarketState(db, marketIdRow.marketId, blockNumber, ReportingState.AWAITING_FINALIZATION);
    dreamteamEmitter.emit(SubscriptionEventNames.MarketState, {
      universe: marketIdRow.universe,
      marketId: marketIdRow.marketId,
      reportingState: ReportingState.AWAITING_FINALIZATION,
    });
    return db("payouts").where({ marketId: marketIdRow.marketId }).update("winning", db.raw(`"tentativeWinning"`));
  });
}

export async function advanceFeeWindowActive(db: Knex, dreamteam: dreamteam, blockNumber: number, timestamp: number) {
  const feeWindowModifications = await updateActiveFeeWindows(db, blockNumber, timestamp);
  if (feeWindowModifications != null && feeWindowModifications.expiredFeeWindows.length === 0 && feeWindowModifications.newActiveFeeWindows.length === 0) return;
  await advanceIncompleteCrowdsourcers(db, blockNumber, feeWindowModifications!.expiredFeeWindows || []);
  await advanceMarketsToAwaitingFinalization(db, dreamteam, blockNumber, feeWindowModifications!.expiredFeeWindows || []);
  await advanceMarketsToCrowdsourcingDispute(db, dreamteam, blockNumber, feeWindowModifications!.newActiveFeeWindows || []);
}

async function advanceMarketsToCrowdsourcingDispute(db: Knex, dreamteam: dreamteam, blockNumber: number, newActiveFeeWindows: Array<Address>) {
  const marketIds: Array<MarketIdUniverseFeeWindow> = await getMarketsWithReportingState(db, ["markets.marketId", "markets.universe", "activeFeeWindow.feeWindow"])
    .join("universes", "markets.universe", "universes.universe")
    .join("fee_windows as activeFeeWindow", "activeFeeWindow.universe", "markets.universe")
    .whereIn("markets.feeWindow", newActiveFeeWindows)
    .where("activeFeeWindow.state", FeeWindowState.CURRENT)
    .where("reportingState", ReportingState.AWAITING_NEXT_WINDOW)
    .where("universes.forked", 0);

  await each(marketIds, async (marketIdRow) => {
    dreamteamEmitter.emit(SubscriptionEventNames.MarketState, {
      universe: marketIdRow.universe,
      feeWindow: marketIdRow.feeWindow,
      marketId: marketIdRow.marketId,
      reportingState: ReportingState.CROWDSOURCING_DISPUTE,
    });
    return updateMarketState(db, marketIdRow.marketId, blockNumber, ReportingState.CROWDSOURCING_DISPUTE);
  });
}

async function advanceIncompleteCrowdsourcers(db: Knex, blockNumber: number, expiredFeeWindows: Array<Address>) {
  // Finds crowdsourcers rows that we don't know the completion of, but are attached to feeWindows that have ended
  // They did not reach their goal, so set completed to 0.
  return db("crowdsourcers").update("completed", 0).whereNull("completed").whereIn("feeWindow", expiredFeeWindows);
}
