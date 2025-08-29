import { Command } from 'commander';
import chalk from 'chalk';
import { PolymarketAPI, OrderRequest } from '../polymarket/api';
import { PolymarketStrategy } from '../polymarket/strategies';
import { FundManager } from '../polymarket/fund';

export function createPolymarketCommand(): Command {
  const api = new PolymarketAPI();
  const strategy = new PolymarketStrategy(api);
  const fund = new FundManager();
  const cmd = new Command('polymarket');
  cmd.description('Interact with Polymarket markets and trading');

  cmd
    .command('markets')
    .description('List active markets')
    .option('-l, --liquidity <num>', 'minimum liquidity', '1000')
    .action(async (opts) => {
      try {
        const markets = await api.getMarkets({
          active: true,
          liquidity_num_min: Number(opts.liquidity),
          order: 'volume',
          ascending: false,
        });
        console.log(JSON.stringify(markets, null, 2));
      } catch (err: any) {
        console.error(chalk.red(`Error fetching markets: ${err.message}`));
      }
    });

  cmd
    .command('positions <user>')
    .description('Get positions for user address')
    .action(async (user: string) => {
      try {
        const positions = await api.getPositions(user);
        console.log(JSON.stringify(positions, null, 2));
      } catch (err: any) {
        console.error(chalk.red(`Error fetching positions: ${err.message}`));
      }
    });

  cmd
    .command('value <user>')
    .description('Get portfolio value for user')
    .option('-m, --market <id>', 'market id')
    .action(async (user: string, opts) => {
      try {
        const value = await api.getPortfolioValue(user, opts.market);
        console.log(JSON.stringify(value, null, 2));
      } catch (err: any) {
        console.error(chalk.red(`Error fetching value: ${err.message}`));
      }
    });

  cmd
    .command('trade')
    .description('Place an order on Polymarket')
    .requiredOption('-m, --market <id>', 'market id')
    .requiredOption('-o, --outcome <id>', 'outcome id')
    .requiredOption('-s, --side <side>', 'buy or sell')
    .requiredOption('-z, --size <number>', 'size')
    .requiredOption('-p, --price <number>', 'price')
    .action(async (opts) => {
      try {
        const order: OrderRequest = {
          market: opts.market,
          outcome: opts.outcome,
          side: opts.side,
          size: Number(opts.size),
          price: Number(opts.price),
        };
        fund.allocate(order.size * order.price);
        const result = await api.placeOrder(order);
        console.log(JSON.stringify(result, null, 2));
      } catch (err: any) {
        console.error(chalk.red(`Error placing order: ${err.message}`));
      }
    });

  cmd
    .command('arbitrage')
    .description('Find cross-market arbitrage opportunities')
    .option('-l, --liquidity <num>', 'minimum liquidity', '1000')
    .option('-t, --threshold <num>', 'spread threshold', '0.05')
    .action(async (opts) => {
      try {
        const opps = await strategy.findCrossMarketArbitrage(
          Number(opts.liquidity),
          Number(opts.threshold)
        );
        console.log(JSON.stringify(opps, null, 2));
      } catch (err: any) {
        console.error(chalk.red(`Error finding arbitrage: ${err.message}`));
      }
    });

  cmd
    .command('strategies')
    .description('List available strategy modules')
    .action(() => {
      console.log(JSON.stringify(strategy.listStrategies(), null, 2));
    });

  cmd
    .command('detect <name>')
    .description('Run opportunity detection for a strategy')
    .option('-l, --liquidity <num>', 'minimum liquidity', '1000')
    .option('-t, --threshold <num>', 'spread or edge threshold', '0.05')
    .option('-u, --user <address>', 'user address for position-based scans')
    .action(async (name: string, opts) => {
      try {
        const res = await strategy.detect(name, {
          minLiquidity: Number(opts.liquidity),
          threshold: Number(opts.threshold),
          user: opts.user,
        });
        console.log(JSON.stringify(res, null, 2));
      } catch (err: any) {
        console.error(chalk.red(`Detection failed: ${err.message}`));
      }
    });

  const fundCmd = cmd.command('fund').description('Manage trading capital');
  fundCmd
    .command('status')
    .description('View available capital')
    .action(() => {
      console.log(JSON.stringify({ capital: fund.getCapital() }, null, 2));
    });

  fundCmd
    .command('deposit <amount>')
    .description('Add capital to the fund')
    .action((amount: string) => {
      try {
        fund.deposit(Number(amount));
        console.log(JSON.stringify({ capital: fund.getCapital() }, null, 2));
      } catch (err: any) {
        console.error(chalk.red(`Deposit failed: ${err.message}`));
      }
    });

  return cmd;
}
