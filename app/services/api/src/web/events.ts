import { SERVICES } from "@onepercent/config";
import { EventsResponse } from "@onepercent/web-api";
import {
  confirmedReplay,
  parseEventCursor,
  type PublicEventSource,
} from "../public/stream.js";

/** Poll and SSE use the same Redis source and canonical confirmed database payload. */
export async function pollEvents(source: PublicEventSource, after?: string) {
  const cursor = parseEventCursor(after);
  const replay = await confirmedReplay(source, cursor);
  if (
    replay.rows.length > SERVICES.api.sseReplayEvents ||
    replay.confirmed.length > replay.rows.length
  )
    throw new Error("stream_window_exceeded");
  return EventsResponse.parse(replay.confirmed);
}
