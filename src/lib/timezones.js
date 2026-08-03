/**
 * Every IANA zone this runtime knows, as one shared set.
 *
 * The booking form, the AI parse route and the Zod schema all have to agree on
 * what counts as a timezone: a value the form offers but the schema rejects
 * comes back as "timezone: Unknown timezone" in a toast, about a field the user
 * did pick from a list. Three copies of `new Set(Intl.supportedValuesOf(...))`
 * agreed only because they ran on the same runtime.
 */
export const SUPPORTED_ZONES = new Set(Intl.supportedValuesOf('timeZone'))
