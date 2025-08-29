import { ToolResult } from '../types';
import { PolymarketAPI, OrderRequest } from '../polymarket/api';
import { PolymarketStrategy } from '../polymarket/strategies';
import { FundManager } from '../polymarket/fund';

export class PolymarketTool {
  private api: PolymarketAPI;
  private strategy: PolymarketStrategy;
  private fund: FundManager;

  constructor() {
    this.api = new PolymarketAPI();
    this.strategy = new PolymarketStrategy(this.api);
    this.fund = new FundManager();
  }

  async execute(action: string, params: any = {}): Promise<ToolResult> {
    try {
        switch (action) {
          case 'get_markets': {
            const markets = await this.api.getMarkets(params);
            return { success: true, output: JSON.stringify(markets, null, 2), data: markets };
          }
        case 'get_positions': {
          const positions = await this.api.getPositions(params.user, params);
          return { success: true, output: JSON.stringify(positions, null, 2), data: positions };
        }
        case 'get_value': {
          const value = await this.api.getPortfolioValue(params.user, params.market);
          return { success: true, output: JSON.stringify(value, null, 2), data: value };
        }
        case 'place_order': {
          const order = params as OrderRequest;
          const result = await this.api.placeOrder(order);
          return { success: true, output: JSON.stringify(result, null, 2), data: result };
        }
        case 'find_wide_spreads': {
          const spreads = await this.strategy.findWideSpreads(params.minLiquidity, params.threshold);
          return { success: true, output: JSON.stringify(spreads, null, 2), data: spreads };
        }
        case 'find_arbitrage': {
          const opps = await this.strategy.findCrossMarketArbitrage(params.minLiquidity, params.threshold);
          return { success: true, output: JSON.stringify(opps, null, 2), data: opps };
        }
        case 'kelly_size': {
          const fraction = this.strategy.calculateKellyPositionSize(params.profitMargin, params.executionProbability, params.maxFraction);
          return { success: true, output: JSON.stringify({ fraction }, null, 2), data: { fraction } };
        }
        case 'fund_status': {
          const capital = this.fund.getCapital();
          return { success: true, output: JSON.stringify({ capital }, null, 2), data: { capital } };
        }
          case 'fund_deposit': {
            this.fund.deposit(params.amount);
            return { success: true, output: JSON.stringify({ capital: this.fund.getCapital() }, null, 2), data: { capital: this.fund.getCapital() } };
          }
          case 'list_strategies': {
            const list = this.strategy.listStrategies();
            return { success: true, output: JSON.stringify(list, null, 2), data: list };
          }
          case 'detect': {
            const opps = await this.strategy.detect(params.strategy, params);
            return { success: true, output: JSON.stringify(opps, null, 2), data: opps };
          }
          default:
            return { success: false, error: `Unknown action: ${action}` };
        }
    } catch (err: any) {
      return { success: false, error: `Polymarket error: ${err.message}` };
    }
  }
}
