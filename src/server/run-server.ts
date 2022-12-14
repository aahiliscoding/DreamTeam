import * as express from "express";
import * as Knex from "knex";
import * as helmet from "helmet";
import * as t from "io-ts";
import * as bodyParser from "body-parser";
import dreamteam from "dreamteam.js";
import { Address, ServersData, JsonRpcRequest, WebSocketConfigs } from "../types";
import { runWebsocketServer } from "./run-websocket-server";
import { addressFormatReviver } from "./address-format-reviver";
import { getMarkets, GetMarketsParams } from "./getters/get-markets";
import { isSyncFinished } from "../blockchain/bulk-sync-dreamteam-node-with-blockchain";
import { isJsonRpcRequest } from "./is-json-rpc-request";
import { dispatchJsonRpcRequest } from "./dispatch-json-rpc-request";
import { makeJsonRpcResponse } from "./make-json-rpc-response";
import { makeJsonRpcError, JsonRpcErrorCode } from "./make-json-rpc-error";
import { EventEmitter } from "events";
import { logger } from "../utils/logger";
import { version } from "../version";
import { currentStandardGasPriceGwei, getGasFetchNote } from "../utils/gas";

// tslint:disable-next-line:no-var-requires
import cors = require("cors");

// tslint:disable-next-line:no-var-requires
const { websocketConfigs } = require("../../config");

export interface RunServerResult {
  app: express.Application;
  servers: ServersData;
}

enum ServerStatus {
  DOWN = "down",
  UP = "up",
  SYNCING = "syncing",
}

export function runServer(db: Knex, dreamteam: dreamteam, controlEmitter: EventEmitter = new EventEmitter()): RunServerResult {
  const app: express.Application = express();

  app.use(
    helmet({
      hsts: false,
    })
  );

  app.use(
    bodyParser.json({
      reviver: addressFormatReviver,
    })
  );

  const servers: ServersData = runWebsocketServer(db, app, dreamteam, websocketConfigs, controlEmitter);

  app.get("/", (req, res) => {
    res.send("dreamteam Node Running, use /status endpoint");
  });

  app.get("/status", (req, res) => {
    try {
      if (!isSyncFinished()) {
        res.status(503).send({ status: ServerStatus.SYNCING, reason: "server syncing" });
        return;
      }

      const networkId: string = dreamteam.rpc.getNetworkID();
      const universe: Address = dreamteam.contracts.addresses[networkId].Universe;

      getMarkets(db, dreamteam, { universe } as t.TypeOf<typeof GetMarketsParams>)
        .then((result: any) => {
          if (result.length === 0) {
            res.status(503).send({ status: ServerStatus.DOWN, reason: "No markets found", universe });
          } else {
            res.send({ status: ServerStatus.UP, universe });
          }
        })
        .catch((e) => {
          throw e;
        });
    } catch (e) {
      res.status(503).send({ status: ServerStatus.DOWN, reason: e.message });
    }
  });

  app.get("/status/database", (req, res) => {
    if (!isSyncFinished()) {
      res.status(503).send({ status: ServerStatus.SYNCING, reason: "server syncing" });
      return;
    }

    const maxPendingTransactions: number = typeof req.query.max_pending_transactions === "undefined" ? 1 : parseInt(req.query.max_pending_transactions, 10);
    if (isNaN(maxPendingTransactions)) {
      res.status(422).send({ error: "Bad value for max_pending_transactions, must be an integer in base 10" });
    } else {
      const waitingClientsCount = db.client.pool.pendingAcquires.length;
      const status = maxPendingTransactions > waitingClientsCount ? ServerStatus.UP : ServerStatus.DOWN;
      res.status(status === ServerStatus.UP ? 200 : 503).send({
        status,
        maxPendingTransactions,
        pendingTransactions: waitingClientsCount,
      });
    }
  });

  app.get("/status/blockage", (req, res) => {
    if (!isSyncFinished()) {
      res.status(503).send({ status: ServerStatus.SYNCING, reason: "server syncing" });
      return;
    }

    db("blocks")
      .orderBy("blockNumber", "DESC")
      .first()
      .asCallback((err: Error, newestBlock: any) => {
        if (err) return res.status(503).send({ error: err.message });
        if (newestBlock == null) return res.status(503).send({ error: "No blocks available" });
        const timestampDelta: number = Math.round(Date.now() / 1000 - newestBlock.timestamp);
        const timestampDeltaThreshold = typeof req.query.time === "undefined" ? 120 : parseInt(req.query.time, 10);
        if (isNaN(timestampDeltaThreshold)) {
          res.status(422).send({ error: "Bad value for time parameter, must be an integer in base 10" });
        }
        const status = timestampDelta > timestampDeltaThreshold ? ServerStatus.DOWN : ServerStatus.UP;
        return res.status(status === ServerStatus.UP ? 200 : 503).send(Object.assign({ status, timestampDelta }, newestBlock));
      });
  });

  app.get("/status/sync", (req, res) => {
    if (!isSyncFinished()) {
      res.status(503).send({ status: ServerStatus.DOWN, reason: "server syncing" });
    } else {
      res.send({ status: ServerStatus.UP, reason: "Finished with sync" });
    }
  });

  app.get("/version", (req, res) => {
    res.send({ version });
  });

  app.get("/gas", (req, res) => {
    res.send({
      gasPriceGwei: currentStandardGasPriceGwei().toNumber(),
      gasFetchNote: getGasFetchNote(),
    });
  });

  app.use(cors());
  app.post("*", cors(), async (req, res) => {
    try {
      const result = await dispatchJsonRpcRequest(db, req.body as JsonRpcRequest, dreamteam);
      res.send(makeJsonRpcResponse(req.body.id, result || null));
    } catch (err) {
      res.status(500);
      res.send(makeJsonRpcError(req.body.id, JsonRpcErrorCode.InvalidParams, err.message, false));
    }
  });

  return { app, servers };
}

export function shutdownServers(servers: ServersData) {
  servers.httpServers.forEach((server, index) => {
    server.close(() => servers.servers[index].close());
  });
}
