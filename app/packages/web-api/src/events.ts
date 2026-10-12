import { z } from "zod";
import { StreamEvent } from "./pending-m2.js";
export const EventsRequest = z.strictObject({
  after: z
    .string()
    .regex(/^\d+-\d+-\d+$/)
    .optional(),
});
export const EventsResponse = z.array(StreamEvent);
