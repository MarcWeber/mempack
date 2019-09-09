import express from "express"
import { createServer, request } from "http";
import { newGlobalState } from "src/GlobalState";
import * as Mempack from "../../src/Mempack"
import * as hmr from "./hmr";
import * as s from "./server";

// global state especially the cache should not be 'reloaded' and kept
export const globalState = newGlobalState({watch: true})

// setup hot reloading once
Mempack.node_hmr(globalState,
  Mempack.resolveContext(() => {
      return {
        // path ?: string, // all paths will be taken relative to this one
        node_modules: ["../../node_modules"],
        entryPoints: [process.argv[1]],
        tsconfig: "../../tsconfig.json",
        // path?: string
        // config: ts.CompilerOptions,
      };
    }),
)

export const clientEntryPoints = ["client.ts"]

const clientConfig: Mempack.ContextUser = {
    entryPoints : clientEntryPoints,
}
const serverConfig = {
    port: process.env.PORT || 3000,
    domain: process.env.domain || "localhost",
}

export const clientHMR = Mempack.clientCode(globalState, {
    type: "globalState",
    // watch: false,
    config: Mempack.resolveContext(() => clientConfig),
    // bundlepath?: (entry:string) => string

})

export const app = (() => {
  const app = express();

  clientHMR.serve_via_express(app, {
    debug_module_graph_path: "/module-graph",
    debug_transpiled_modules: "/transpiled-modules",
  })

  // hack, use exports.server to have it updated
  app.get("/", (r, rr) => hmr.serve(r, rr))

  const server = createServer(app);
  server.listen(serverConfig.port)

  server.on("listening", () => {
    const addr = server.address();
    if (addr == null) {
      console.log(`Listening on failed`);
    } else {
      const bind = typeof addr === "string" ? `pipe ${addr}` : `port ${addr.port}`;
      console.log(`Listening on ${bind}`);
    }
  });
  server.on("error", console.log)

})()
