import express from "express"
import { createServer, request } from "http";
import * as Mempack from "../../src/Mempack"
import { clientEntryPoints, clientHMR } from "./nohmr";
import * as s from "./server";

// code which should get hot reloaded explicitely
// eg see nohmr which is most important
// but code here so that you only reload this file and not other code by accident

export const serve = async (request: express.Request, response: express.Response) => {
  // change HTML and reload page
  response.send(`
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <script>
    </script>
    ${await clientHMR.jsfiles_as_html(clientEntryPoints)}
  </head>
  <body>
  </body>
</html>
`)
}
