import * as WebSocket from "ws";
import dreamteam from "dreamteam.js";

const dreamteam_NODE_WS = process.env.dreamteam_NODE_WS || "ws://localhost:9001";

export const dreamteam = new dreamteam();

export async function dreamteamNodeRequest(method: string, params?: {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(dreamteam_NODE_WS);
    const jsonId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          id: jsonId,
          jsonrpc: "2.0",
          method,
          params,
        })
      );
    });
    ws.on("message", (response) => {
      const responseParsed = JSON.parse(response.toString());
      if (responseParsed.id !== jsonId) {
        return reject("Bad ID");
      }
      resolve(responseParsed.result);
      ws.close();
    });
  });
}

export async function getContractAddresses() {
  const netId = (await dreamteamNodeRequest("getContractAddresses", {})).netId;
  return dreamteam.contracts.addresses[netId];
}
