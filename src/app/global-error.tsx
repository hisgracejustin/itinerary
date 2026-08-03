"use client";

// Last-resort boundary: it replaces the root layout, so it must render its own
// <html>/<body> and can't rely on the stylesheet having loaded — hence inline
// styles rather than Tailwind classes.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8f9fa" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              border: "1px solid #f1f3f4",
              padding: 32,
              maxWidth: 360,
              width: "100%",
              textAlign: "center",
            }}
          >
            <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "#202124" }}>
              Itinerary hit an unexpected error
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#5f6368" }}>
              Reloading usually clears it.
            </p>
            {error.digest && (
              <p style={{ margin: "8px 0 0", fontSize: 10, color: "#9aa0a6" }}>
                ref {error.digest}
              </p>
            )}
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 20,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 500,
                color: "#fff",
                background: "#33ab9f",
                border: "none",
                borderRadius: 999,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
