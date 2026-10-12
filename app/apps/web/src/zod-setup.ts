import { z } from "zod";

// Imported first by main.tsx: ES modules evaluate imports before the importer's
// body, so this must run before any module parses a schema. Without it, zod's
// eval probe trips the CSP (`script-src` without 'unsafe-eval').
z.config({ jitless: true });
