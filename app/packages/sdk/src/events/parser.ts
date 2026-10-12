import { decodeOnepercentEvent } from "./decoder.js";
import type { OnepercentEvent } from "./types.js";

export type IndexedOnepercentEvent = OnepercentEvent & {
  ixIndex: number;
  eventIndex: number;
  logIndex: number;
};

export interface ParseOnepercentLogsInput {
  logs: readonly string[] | null;
  err: unknown;
  programId: string;
  /** Actual message instruction program IDs, including instructions without logs. */
  topLevelProgramIds?: readonly string[];
}

export interface ParsedOnepercentLogs {
  events: IndexedOnepercentEvent[];
  truncated: boolean;
  unknownEvent: boolean;
  malformed: boolean;
}

type PendingEvent = OnepercentEvent & { ixIndex: number; logIndex: number };
interface Frame {
  programId: string;
  ixIndex: number;
  events: (PendingEvent | null)[];
}

const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[([1-9][0-9]*)\]$/;
const finish = /^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed:.*)$/;

/** Only runtime invocation frames can authorize event decoding. */
export function parseOnepercentLogs({
  logs,
  err,
  programId,
  topLevelProgramIds,
}: ParseOnepercentLogsInput): ParsedOnepercentLogs {
  const result: ParsedOnepercentLogs = {
    events: [],
    truncated: false,
    unknownEvent: false,
    malformed: false,
  };
  if (err !== null) return result;
  if (logs === null) return { ...result, truncated: true };
  const frames: Frame[] = [];
  const committed: (PendingEvent | null)[] = [];
  let nextInstruction = 0;

  for (const [logIndex, line] of logs.entries()) {
    if (/^Log truncated(?:$|:)/.test(line)) {
      result.truncated = true;
      break;
    }
    const entry = invoke.exec(line);
    if (entry) {
      const id = entry[1]!;
      const depth = Number(entry[2]);
      if (depth !== frames.length + 1) {
        return { ...result, events: [], malformed: true };
      }
      let ixIndex = frames[0]?.ixIndex;
      if (depth === 1) {
        ixIndex = topLevelProgramIds
          ? topLevelProgramIds.indexOf(id, nextInstruction)
          : nextInstruction;
        if (ixIndex < 0) {
          return { ...result, events: [], malformed: true };
        }
        nextInstruction = ixIndex + 1;
      }
      frames.push({ programId: id, ixIndex: ixIndex!, events: [] });
      continue;
    }
    if (/^Program \S+ invoke\b/.test(line)) {
      return { ...result, events: [], malformed: true };
    }
    const completion = finish.exec(line);
    if (completion) {
      const frame = frames.pop();
      if (!frame || frame.programId !== completion[1]) {
        return { ...result, events: [], malformed: true };
      }
      if (completion[2] === "success") {
        (frames.at(-1)?.events ?? committed).push(...frame.events);
      }
      // A failed frame also rolls back successful nested program invocations.
      continue;
    }
    if (/^Program \S+ (?:success|failed)\b/.test(line)) {
      return { ...result, events: [], malformed: true };
    }
    const frame = frames.at(-1);
    if (frame?.programId !== programId || !line.startsWith("Program data: ")) {
      continue;
    }
    try {
      const event = decodeOnepercentEvent(line.slice("Program data: ".length));
      if (event)
        frame.events.push({ ...event, ixIndex: frame.ixIndex, logIndex });
      else {
        frame.events.push(null);
        result.unknownEvent = true;
      }
    } catch {
      frame.events.push(null);
      result.unknownEvent = true;
    }
  }
  if (frames.length > 0 && !result.truncated) {
    return { ...result, events: [], malformed: true };
  }
  // Incomplete frames may have failed after truncation: reconcile their accounts.
  // Unknown events still reserve their ordinal so an IDL update cannot shift IDs.
  result.events = committed.flatMap((event, eventIndex) =>
    event ? [{ ...event, eventIndex }] : [],
  );
  return result;
}
