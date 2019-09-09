import { Server } from "ws";
import { log } from "./log";

export interface ISocketClientInterface {
  onMessage?: (fn: (name: string, payload: any) => void) => void;
  sendEvent(name: string, payload?: any): any;
}
// keep that in mind:
// https://github.com/elsassph/react-hmr-ts/tree/master/examples/fuse-box

export type HMRServerMethods = ISocketClientInterface & {};
export interface ICreateHMRServerProps {
  internalServer?: any;
  port?: number
}

export type Listener = (name: string, payload: any) => void

export function createHMRServer(props: ICreateHMRServerProps): HMRServerMethods {
  const serverOpts: any = {};
  if (props.internalServer) {
    serverOpts.server = props.internalServer;
  } else {
    serverOpts.port = props.port;
  }
  const wss = new Server(serverOpts);
  const clients = new Set<ISocketClientInterface>();
  const scope: {listeners: Listener[]} = {
    listeners: [],
  };
  log(`<dim>HMR server is running on port ${props.port}</dim>`);
  wss.on("connection", function connection(ws) {
    const client = {
      sendEvent(name: string, payload?: any) {
        ws.send(JSON.stringify({ name, payload }));
      },
    }
    clients.add(client);
    ws.on("close", () => {
      //
    });
    ws.on("message", function incoming(data) {
      const json = JSON.parse(data as string); // FIXME TYPING as string
      scope.listeners.forEach((fn: any) => {
        fn(json.name, json.payload);
      });
    });
  });

  return {
    onMessage: (fn: Listener) => {
      scope.listeners.push(fn);
    },
    sendEvent: (name: string, payload?) => {
      clients.forEach((client) => client.sendEvent(name, payload));
    },
  };
}
