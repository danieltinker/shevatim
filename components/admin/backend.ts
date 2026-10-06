// The back office talks to the database only through lib/api.ts (the frozen contract).
import * as real from "@/lib/api";
export const api = real;
