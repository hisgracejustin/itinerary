export function dedupeById(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function sortOptionsByPrice(options, direction) {
  const items = [...(options || [])];
  if (direction !== "asc" && direction !== "desc") return items;

  const multiplier = direction === "asc" ? 1 : -1;
  return items
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const aAmount = a.option?.cost_amount == null ? null : Number(a.option.cost_amount);
      const bAmount = b.option?.cost_amount == null ? null : Number(b.option.cost_amount);
      const aPrice = Number.isFinite(aAmount) ? aAmount : null;
      const bPrice = Number.isFinite(bAmount) ? bAmount : null;

      // Unpriced options remain at the end in either direction.
      if (aPrice == null && bPrice == null) return a.index - b.index;
      if (aPrice == null) return 1;
      if (bPrice == null) return -1;
      return multiplier * (aPrice - bPrice) || a.index - b.index;
    })
    .map(({ option }) => option);
}

/**
 * Server data is authoritative. The only local records retained across an RSC
 * refresh are option ids with a mutation currently in flight.
 */
export function mergeConsideringSets(local, server, pendingOptionIds = new Set()) {
  if (!server) return local || [];
  const localSets = new Map((local || []).map((set) => [set.id, set]));

  return server.map((serverSet) => {
    const localSet = localSets.get(serverSet.id);
    if (!localSet) return { ...serverSet, options: dedupeById(serverSet.options || []) };

    const localOptions = new Map((localSet.options || []).map((option) => [option.id, option]));
    const options = (serverSet.options || []).map((serverOption) => {
      if (!pendingOptionIds.has(serverOption.id)) return serverOption;
      const localOption = localOptions.get(serverOption.id);
      return localOption
        ? {
            ...serverOption,
            images: dedupeById([
              ...(serverOption.images || []),
              ...(localOption.images || []),
            ]),
          }
        : serverOption;
    });

    const serverIds = new Set(options.map((option) => option.id));
    for (const localOption of localSet.options || []) {
      if (pendingOptionIds.has(localOption.id) && !serverIds.has(localOption.id)) {
        options.push(localOption);
      }
    }
    return { ...serverSet, options: dedupeById(options) };
  });
}
