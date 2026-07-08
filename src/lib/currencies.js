/**
 * Supported currencies and FX rates to HKD.
 * Rates as of June 3, 2026 (approximate).
 */

export const CURRENCIES = [
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'THB', symbol: '฿', name: 'Thai Baht' },
  { code: 'KRW', symbol: '₩', name: 'South Korean Won' },
  { code: 'TWD', symbol: 'NT$', name: 'Taiwan Dollar' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
]

// Rates: 1 unit of currency = X HKD
export const FX_RATES_TO_HKD = {
  HKD: 1,
  USD: 7.80,
  EUR: 8.50,
  GBP: 9.85,
  JPY: 0.051,
  CNY: 1.08,
  CAD: 5.70,
  AUD: 5.10,
  SGD: 5.85,
  THB: 0.22,
  KRW: 0.0057,
  TWD: 0.24,
  NZD: 4.70,
  CHF: 8.75,
  INR: 0.082,
}

/**
 * Convert an amount in a given currency to HKD.
 */
export function toHKD(amount, currency) {
  const rate = FX_RATES_TO_HKD[currency]
  if (!rate) return amount
  return amount * rate
}

/**
 * Format a currency amount for display.
 */
export function formatCurrency(amount, currency) {
  const curr = CURRENCIES.find((c) => c.code === currency)
  const symbol = curr?.symbol || currency
  // For JPY/KRW use no decimals
  const decimals = ['JPY', 'KRW', 'TWD'].includes(currency) ? 0 : 2
  return `${symbol}${amount.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}
