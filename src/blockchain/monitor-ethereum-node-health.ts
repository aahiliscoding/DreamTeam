import { dreamteam } from "dreamteam.js";
import { ErrorCallback } from "../types";

const POLLING_FREQUENCY_IN_MS = 5000;

// This should really go on dreamteam.js
function getNetworkAddresses(dreamteam: dreamteam) {
  const networkId: string = dreamteam.rpc.getNetworkID();
  const addresses = dreamteam.contracts.addresses[networkId];
  if (addresses === undefined) throw new Error(`getNetworkID result does not map to a set of contracts: ${networkId}`);
  return addresses;
}

export async function monitorEthereumNodeHealth(dreamteam: dreamteam, errorCallback: ErrorCallback | undefined) {
  try {
    const { Universe: universe, Controller: controller } = getNetworkAddresses(dreamteam);
    setTimeout(() => monitorEthereumNodeHealth(dreamteam, errorCallback), POLLING_FREQUENCY_IN_MS);
  } catch (err) {
    if (errorCallback) errorCallback(err);
  }
}
