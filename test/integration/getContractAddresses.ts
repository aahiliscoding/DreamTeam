import { expect } from "chai";
import "mocha";
import { dreamteam, dreamteamNodeRequest } from "./utils";

describe("getSyncData", () => {
  let result: any;
  before(async () => {
    result = await dreamteamNodeRequest("getSyncData", {});
  });
  it("isSyncFinished", () => {
    expect(result.isSyncFinished).to.equal(true);
  });
  it("contract addresses match", () => {
    expect(result.addresses).to.deep.equal(dreamteam.contracts.addresses[result.netId]);
  });
});
