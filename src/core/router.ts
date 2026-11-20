import type { Mode } from "../shared/types.js";
export function route(_input: string, _tier: number, explicitMode?: Mode): Mode { return explicitMode ?? "ask"; }
