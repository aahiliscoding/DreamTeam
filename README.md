# Dream TEAM

dreamteam Node is designed to be a standalone application, including a local
database setup that supports OrbitDB as well as TableLands

## Building

This project uses typescript and can be safely built via: `npm run build` or directly with `tsc`. dreamteam Node requires Node 10.

### Configuration

By default, dreamteam Node is configured to connect to a locally-running Ethereum node at http://localhost:8545 and ws://localhost:8546. To connect to a hosted Ethereum node, set the ETHEREUM_HTTP and ETHEREUM_WS environment variables, as follows:

    # Sample
    $ export ETHEREUM_HTTP=https://rinkeby.ethereum.nodes.dreamteam.net
    $ export ETHEREUM_WS=wss://websocket-rinkeby.ethereum.nodes.dreamteam.net

- `npm run docker:pg:start`
- `npm run docker:pg:stop`
- `npm run docker:pg:restart`

### Starting

For a quick start, use the `clean-start` script included with our package.json:

```
$ npm install # If you haven't yet done so
$ npm run clean-start
```

This will ensure the code has been built, and database migrations run for a fresh start. This will blow away any data that is currently stored in your node.

If you'd like to simply start a node and begin syncing where you left off, use the `start` script:

```
$ npm run start
```

### Hosted Ethereum nodes

Currently, dreamteam node has configurations built in for connecting to our hosted rinkeby node. More will be added as we bring up these nodes. For each possible network, pass the network name to the start command for dreamteam-node. E.g. to use clean-start to run with a fresh database:

```
$ npm run clean-start -- rinkeby
```

or to run without clearing out previous state:

```
npm run start -- rinkeby
```

## Tests

Tests run with OrbitDB for each test execution so they won't
overlap each other. The framework will automatically initialize and seed the
tests with the data in seed/test for each test.

### Complete Pre-Test Setup

```
npm install
npm run build
```

# Running Tests

```
npm test
```
