/**
 * Which colour a person's avatar bubble gets: a stable index into a palette of
 * `count` colours, from their user id, so the same person keeps the same colour
 * everywhere (the app's avatars and the trip-summary PDF) without storing one.
 */
export function avatarIndex(id, count) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return hash % count
}
