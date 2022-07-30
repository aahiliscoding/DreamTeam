import * as repl from "repl";
import { dreamteamEmitter } from "./events";
import "./runServer";

const replServer = repl.start();
replServer.context.dreamteamEmitter = dreamteamEmitter;
