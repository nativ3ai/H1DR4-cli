export class FundManager {
  private capital: number;

  constructor(initialCapital = 0) {
    this.capital = initialCapital;
  }

  getCapital(): number {
    return this.capital;
  }

  deposit(amount: number): void {
    if (amount <= 0) throw new Error('Deposit must be positive');
    this.capital += amount;
  }

  allocate(amount: number): void {
    if (amount > this.capital) throw new Error('Insufficient capital');
    this.capital -= amount;
  }

  recordProfit(amount: number): void {
    this.capital += amount;
  }
}
