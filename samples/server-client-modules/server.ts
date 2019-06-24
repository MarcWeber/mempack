import express from "express"
import { createServer, request } from "http";
import * as Mempack from "../../src/Mempack"

const globalState = Mempack.newGlobalState()

const clientEntryPoints = ["client.ts"]

const clientConfig: Mempack.ContextUser = {
    entryPoints : clientEntryPoints,
}

const serverConfig = {
    port: process.env.PORT || 3000,
    domain: process.env.domain || "localhost",
}

const app = express()

const clientHMR = Mempack.clientCode(globalState, {
    type: "meta_modules",
    // watch: false,
    config: Mempack.resolveContext(() => clientConfig),
    // bundlepath?: (entry:string) => string
  })
clientHMR.serve_via_express(app, {
  debug_module_graph_path: "/module-graph",
  debug_transpiled_modules: "/transpiled-modules",
})
app.get("/", async (request, response) => {
  response.send(`
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    ${await clientHMR.jsfiles_as_html(clientEntryPoints)}
  </head>
  <body>
  </body>
</html>
`)
})

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
