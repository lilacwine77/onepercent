/** S4 operational admission/backpressure defaults, pending PARAMS consolidation.
 * These bound sockets and memory only; no transaction or exit route uses them.
 */
export const PUBLIC_STREAM_LIMITS = {
  maxClients: 200,
  maxClientsPerIp: 4,
  queuedEventsPerClient: 32,
} as const;
