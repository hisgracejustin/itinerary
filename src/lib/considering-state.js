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
 * Cheapest-option summary for a decision's options.
 * Amounts are only comparable within a single currency — the app never
 * FX-converts for anything a user acts on.
 */
export function summarizePrices(options) {
  const priced = (options || []).filter((o) => {
    const amount = o?.cost_amount == null ? null : Number(o.cost_amount);
    return Number.isFinite(amount) && !!o?.cost_currency;
  });

  const currencies = new Set(priced.map((o) => o.cost_currency));
  if (priced.length < 2 || currencies.size !== 1) {
    return { comparable: false, currency: null, cheapestIds: new Set(), deltas: new Map() };
  }

  const amounts = priced.map((o) => Number(o.cost_amount));
  const min = Math.min(...amounts);
  const cheapestIds = new Set(priced.filter((o) => Number(o.cost_amount) === min).map((o) => o.id));
  const deltas = new Map(priced.map((o) => [o.id, Number(o.cost_amount) - min]));

  return { comparable: true, currency: priced[0].cost_currency, cheapestIds, deltas };
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
