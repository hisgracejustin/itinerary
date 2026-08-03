/**
 * Connection options for the operator scripts (migrate, infer-timezones).
 *
 * Two things about Neon's connection strings that node-postgres does not
 * handle on its own, both of which fail in ways that don't name their cause:
 *
 *  - `channel_binding=require`. Neon puts this in the string it hands you, but
 *    node-postgres doesn't implement SCRAM channel binding, so the server drops
 *    the socket mid-handshake. What surfaces is `Connection terminated
 *    unexpectedly` — nothing about channel binding at all. Dropped here; TLS
 *    below still authenticates the server.
 *  - TLS. Neon refuses plaintext, and a string without `sslmode` connects
 *    without it. Forced on, with certificate verification left ON (Neon serves
 *    a publicly-rooted cert, so this needs no CA bundle).
 *
 * The timeout is generous because a suspended Neon compute takes a few seconds
 * to wake on the first connection.
 */

export function pgOptions(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete("channel_binding");
  const sslmode = parsed.searchParams.get("sslmode");
  return {
    connectionString: parsed.toString(),
    ssl: sslmode === "disable" ? false : { rejectUnauthorized: true },
    connectionTimeoutMillis: 20_000,
  };
}

/**
 * Turn a connection failure into something that says what to try next. These
 * scripts are run by hand, usually once, often against a database whose URL was
 * pasted from a dashboard — so the failure modes are configuration, not code.
 */
export function explainPgError(err, url) {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "(unparseable URL)";
    }
  })();
  const msg = String(err?.message ?? err);
  const lines = [`could not connect to ${host}: ${msg}`, ""];

  if (/terminated unexpectedly|ECONNRESET|socket hang up/i.test(msg)) {
    lines.push(
      "  That usually means the server closed the connection during the TLS or",
      "  auth handshake. Most likely one of:",
      "    · the URL is Neon's psql/CLI form rather than a plain connection string",
      "    · the password contains a character that needs URL-encoding (@ : / ?)",
      "    · the branch or role in the URL no longer exists",
    );
  } else if (/password authentication failed|SASL|SCRAM/i.test(msg)) {
    lines.push("  Credentials were rejected — re-copy the connection string from Neon.");
  } else if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) {
    lines.push("  Hostname didn't resolve. Check for a truncated paste.");
  } else if (/timeout/i.test(msg)) {
    lines.push(
      "  Timed out. A suspended Neon compute wakes in a few seconds, so a repeat",
      "  run often succeeds; if it never does, check IP restrictions on the project.",
    );
  } else if (/self.signed|certificate/i.test(msg)) {
    lines.push("  TLS verification failed — unexpected for Neon. Check for a proxy.");
  }

  lines.push(
    "",
    "  Use the DIRECT (non-pooler) host: ep-xxx.region.aws.neon.tech,",
    "  not ep-xxx-pooler.region.aws.neon.tech.",
  );
  return lines.join("\n");
}
