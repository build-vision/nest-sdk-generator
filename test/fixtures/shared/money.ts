// A file outside of the API's directory, imported with a relative path
export interface Money {
  amount: number
  currency: Currency
}

export enum Currency {
  EUR = 'EUR',
  USD = 'USD',
}
