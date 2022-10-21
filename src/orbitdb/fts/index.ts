import * as Knex from "knex";
import * as IPFS from "ipfs";

export function createSearchProvider(db: Knex): SearchProvider | null {
  switch (db.client.config.client) {
    case "orbitdb":
      return new SearchOrbitDB(db);
    default:
      console.log("Full Text Search not available with this database. In the future we will provide a backup.");
  }
  return null;
}

const SearchOrbitDB = (db: any) => {
  const ipfs = await IPFS.create();
  const orbitdb = await OrbitDB.createInstance(ipfs);

  // Create / Open a database
  const db = await orbitdb.log("dreamTeam");
  await db.load();

  // Listen for updates from peers
  db.events.on("replicated", (address) => {
    console.log(db.iterator({ limit: -1 }).collect());
  });

  // Query
  const result = db.iterator({ limit: -1 }).collect();
  return result;
};
