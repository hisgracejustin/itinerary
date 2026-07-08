const RLS_PATTERN = /row-level security|violates.*policy/i

export function friendlyError(err) {
  const msg = err?.message || String(err)
  if (RLS_PATTERN.test(msg)) {
    return "You don't have permission to make changes to this trip"
  }
  return msg
}
