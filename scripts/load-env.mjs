/**
 * Load env the way Next.js does, which is NOT what `dotenv/config` does.
 *
 * Plain dotenv reads `.env` and stops. Next.js reads `.env.local` first and lets
 * it win over `.env` — so a value put in `.env.local`, which is the gitignored
 * one and therefore where secrets belong, is invisible to a script that only
 * imports `dotenv/config`. That mismatch is silent: the script reports "no
 * database" while the URL is sitting right there in the file.
 *
 * Precedence here matches Next: .env.local overrides .env, and a variable
 * already set in the real environment overrides both.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });
