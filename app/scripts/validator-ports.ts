import { createSocket } from "node:dgram";

/** Gossip uses UDP; an available RPC TCP port does not prove UDP availability. */
export async function freeGossipPort(excluded: number[]): Promise<number> {
  const socket = createSocket("udp4");
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, "127.0.0.1", resolve);
  });
  const port = socket.address().port;
  await new Promise<void>((resolve) => socket.close(resolve));
  return excluded.includes(port) ? freeGossipPort(excluded) : port;
}
