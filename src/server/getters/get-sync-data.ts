import * as t from "io-ts";
import * as Knex from "knex";
import dreamteam from "dreamteam.js";
import { isSyncFinished } from "../../blockchain/bulk-sync-dreamteam-node-with-blockchain";
import { version } from "../../version";

export const NoParams = t.type({});

export interface UISyncData {
  version: string;
  dreamteamNodeVersion: string;
  net_version: string;
  netId: string;
  isSyncFinished: boolean;
  addresses: {};
  highestBlock: {};
  lastProcessedBlock: {};
}

export async function getSyncData(db: Knex, dreamteam: dreamteam, params: t.TypeOf<typeof NoParams>): Promise<UISyncData> {
  const currentBlock = dreamteam.rpc.getCurrentBlock();
  const highestBlock = {
    number: parseInt(currentBlock.number, 16),
    hash: currentBlock.hash,
    timestamp: parseInt(currentBlock.timestamp, 16),
  };
  const lastProcessedBlock = await db("blocks").first(["blockNumber as number", "blockHash as hash", "timestamp"]).orderBy("blockNumber", "DESC");
  return {
    version: dreamteam.version,
    dreamteamNodeVersion: version,
    net_version: dreamteam.rpc.getNetworkID(),
    netId: dreamteam.rpc.getNetworkID(),
    isSyncFinished: isSyncFinished(),
    addresses: dreamteam.contracts.addresses[dreamteam.rpc.getNetworkID()],
    highestBlock,
    lastProcessedBlock,
  };
}
