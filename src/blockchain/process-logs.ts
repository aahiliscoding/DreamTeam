import dreamteam from "dreamteam.js";
import * as Knex from "knex";
import { EventLogProcessor, FormattedEventLog } from "../types";
import { logProcessors } from "./log-processors";
import { dreamteamEmitter } from "../events";
import { SubscriptionEventNames } from "../constants";

export async function processLog(dreamteam: dreamteam, log: FormattedEventLog, logProcessor: EventLogProcessor): Promise<(db: Knex) => Promise<void>> {
  return (!log.removed ? logProcessor.add : logProcessor.remove)(dreamteam, log);
}

export function processLogByName(dreamteam: dreamteam, log: FormattedEventLog, emitEvent: boolean): null | Promise<(db: Knex) => Promise<void>> {
  const contractProcessors = logProcessors[log.contractName];
  if (contractProcessors && contractProcessors[log.eventName]) {
    const logProcessor = contractProcessors[log.eventName];
    if (emitEvent) {
      if (!logProcessor.noAutoEmit) {
        const subscriptionEventName = log.eventName as keyof typeof SubscriptionEventNames;
        dreamteamEmitter.emit(SubscriptionEventNames[subscriptionEventName], log);
      }
    }
    return processLog(dreamteam, log, contractProcessors[log.eventName]);
  }
  return null;
}
