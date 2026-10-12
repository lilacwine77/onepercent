import { initial } from "./catalog-initial.js";
import { routes } from "./catalog-routes.js";

// Full catalog for package consumers and strict COPY.md parity.
export const en = { ...initial, ...routes } as const;
