import { z } from "zod";
import { PublicKeyString } from "./primitives.js";
export const LogoParams = z.strictObject({ mint: PublicKeyString });
export const LogoContentType = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
