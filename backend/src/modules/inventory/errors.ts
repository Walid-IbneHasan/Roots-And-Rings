export class OutOfStockError extends Error {
  statusCode = 409;
  constructor(public variantId: string) {
    super(`Insufficient stock for variant ${variantId}`);
    this.name = 'OutOfStockError';
  }
}
