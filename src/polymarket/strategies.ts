import { PolymarketAPI } from './api';

export interface StrategyInfo {
  name: string;
  description: string;
}

export class PolymarketStrategy {
  constructor(private api: PolymarketAPI) {}

  private strategyMap: Record<string, { description: string; detect?: (p: any) => Promise<any[]> }> = {
    cross_market_arbitrage: {
      description: 'Exploit price discrepancies for identical outcomes across markets.',
      detect: async (p: any) =>
        this.findCrossMarketArbitrage(p?.minLiquidity, p?.threshold),
    },
    lp_market_pools: {
      description: 'Provide liquidity to wide-spread markets to capture fees delta-neutrally.',
      detect: async (p: any) =>
        this.findWideSpreads(p?.minLiquidity, p?.threshold),
    },
    bayesian_market_lag: {
      description: 'Process new information faster than markets react and trade the delay.',
      detect: async (p: any) => this.findBayesianLag(p?.threshold),
    },
    trade_the_oracle: {
      description: 'Anticipate resolution source behavior and biases.',
      detect: async (p: any) => this.findOracleBias(p?.minLiquidity),
    },
    reflexivity_farming: {
      description: 'Take positions that incentivize actions shaping the outcome.',
      detect: async (p: any) => this.findReflexiveMarkets(p?.minLiquidity),
    },
    odds_to_perps: {
      description: 'Translate prediction odds into signals for perpetual or spot markets.',
      detect: async (p: any) => this.findTokenSignals(p?.minLiquidity),
    },
    attention_front_run: {
      description: 'Spot narrative momentum via new market activity and volume spikes.',
      detect: async (p: any) =>
        this.findAttentionSpikes(p?.minLiquidity, p?.threshold),
    },
    synthetic_options: {
      description: 'Treat markets as options to trade volatility and time decay.',
      detect: async (p: any) =>
        this.findThetaMarkets(p?.minLiquidity, p?.threshold),
    },
    construct_parlay: {
      description: 'Layer multiple markets for targeted exposure or hedging.',
      detect: async (p: any) =>
        this.findParlayMismatches(p?.minLiquidity, p?.threshold),
    },
    tax_harvest: {
      description: 'Realize prediction market losses for regulatory advantages where applicable.',
      detect: async (p: any) =>
        this.findTaxLossPositions(p?.user, p?.threshold),
    },
    infrastructure_tokens: {
      description: 'Use platform health metrics to time positions in native tokens.',
      detect: async () => this.analyzeInfrastructure(),
    },
  };

  listStrategies(): StrategyInfo[] {
    return Object.entries(this.strategyMap).map(([name, { description }]) => ({
      name,
      description,
    }));
  }

  async detect(name: string, params: any = {}): Promise<any[]> {
    const strat = this.strategyMap[name];
    if (!strat) {
      throw new Error(`Unknown strategy: ${name}`);
    }
    if (!strat.detect) {
      return [];
    }
    return strat.detect(params);
  }

  /**
   * Find markets with spreads wider than threshold
   */
  async findWideSpreads(minLiquidity = 1000, spreadThreshold = 0.05): Promise<any[]> {
    const markets = await this.api.getMarkets({
      active: true,
      liquidity_num_min: minLiquidity,
      order: 'volume',
      ascending: false,
    });

    const opportunities: any[] = [];
    for (const m of markets) {
      const bestBid = m.bestBid ?? 0;
      const bestAsk = m.bestAsk ?? 0;
      const spread = bestAsk - bestBid;
      if (bestBid && bestAsk && spread > spreadThreshold) {
        opportunities.push({ id: m.id, slug: m.slug, bestBid, bestAsk, spread });
      }
    }
    return opportunities;
  }

  /**
   * Identify cross-market arbitrage opportunities by comparing prices of
   * markets with identical slugs. This is a lightweight implementation that
   * groups active markets by slug and flags any groups where the price spread
   * between outcomes exceeds the specified threshold.
   */
  async findCrossMarketArbitrage(
    minLiquidity = 1000,
    spreadThreshold = 0.05
  ): Promise<any[]> {
    const markets = await this.api.getMarkets({
      active: true,
      liquidity_num_min: minLiquidity,
    });

    const groups: Record<string, any[]> = {};
    for (const m of markets) {
      if (!groups[m.slug]) groups[m.slug] = [];
      groups[m.slug].push(m);
    }

    const opportunities: any[] = [];
    for (const slug of Object.keys(groups)) {
      const group = groups[slug];
      if (group.length < 2) continue;
      const prices = group.map((g) => g.yesPrice ?? g.lastPrice ?? 0);
      const max = Math.max(...prices);
      const min = Math.min(...prices);
      if (max - min > spreadThreshold) {
        opportunities.push({ slug, max, min, spread: max - min });
      }
    }
    return opportunities;
  }

  /**
   * Markets with stale trading activity may indicate a lag between new
   * information and market pricing. This heuristic flags markets whose last
   * trade timestamp exceeds the supplied hour threshold.
   */
  async findBayesianLag(maxHours = 24): Promise<any[]> {
    const markets = await this.api.getMarkets({ active: true });
    const thresholdMs = maxHours * 60 * 60 * 1000;
    const now = Date.now();
    const stale: any[] = [];
    for (const m of markets) {
      const last = Date.parse(m.lastTradeTime || m.last_trade_time || m.updated || '');
      if (last && now - last > thresholdMs) {
        stale.push({ id: m.id, slug: m.slug, lastTrade: m.lastTradeTime || m.last_trade_time || m.updated });
      }
    }
    return stale;
  }

  /**
   * Identify markets whose resolution source may introduce oracle bias. Here we
   * simply surface markets with explicit resolutionSource metadata so that
   * humans can evaluate potential subjectivity.
   */
  async findOracleBias(minLiquidity = 0): Promise<any[]> {
    const markets = await this.api.getMarkets({ active: true, liquidity_num_min: minLiquidity });
    return markets
      .filter((m: any) => typeof m.resolutionSource === 'string')
      .map((m: any) => ({ id: m.id, slug: m.slug, resolutionSource: m.resolutionSource }));
  }

  /**
   * Detect markets where participant actions can influence outcomes. We use a
   * keyword filter as a lightweight proxy for reflexive incentives.
   */
  async findReflexiveMarkets(minLiquidity = 0): Promise<any[]> {
    const markets = await this.api.getMarkets({ active: true, liquidity_num_min: minLiquidity });
    const keywords = ['launch', 'release', 'deploy', 'mint', 'vote', 'upgrade'];
    const reflexive: any[] = [];
    for (const m of markets) {
      const title = (m.title || '').toLowerCase();
      if (keywords.some((k) => title.includes(k))) {
        reflexive.push({ id: m.id, slug: m.slug, title: m.title });
      }
    }
    return reflexive;
  }

  /**
   * Use prediction odds as directional signals for tokens or perps. We surface
   * markets mentioning price or token keywords along with their current odds.
   */
  async findTokenSignals(minLiquidity = 0): Promise<any[]> {
    const markets = await this.api.getMarkets({ active: true, liquidity_num_min: minLiquidity });
    const keywords = ['price', 'token', 'coin', 'market cap'];
    const signals: any[] = [];
    for (const m of markets) {
      const title = (m.title || '').toLowerCase();
      if (keywords.some((k) => title.includes(k))) {
        const price = m.yesPrice ?? m.lastPrice ?? 0;
        signals.push({ id: m.id, slug: m.slug, price });
      }
    }
    return signals;
  }

  /**
   * Identify newly created markets attracting outsized volume, a proxy for
   * emerging narratives and attention flows.
   */
  async findAttentionSpikes(minLiquidity = 0, volumeThreshold = 10000): Promise<any[]> {
    const markets = await this.api.getMarkets({
      active: true,
      liquidity_num_min: minLiquidity,
      order: 'volume',
      ascending: false,
    });
    const now = Date.now();
    const recentMs = 3 * 24 * 60 * 60 * 1000; // 3 days
    const spikes: any[] = [];
    for (const m of markets) {
      const start = Date.parse(m.start_date || m.created || '');
      if (start && now - start < recentMs && (m.volume || 0) > volumeThreshold) {
        spikes.push({ id: m.id, slug: m.slug, volume: m.volume });
      }
    }
    return spikes;
  }

  /**
   * Markets nearing resolution with balanced odds behave like options with high
   * theta. We flag markets ending soon whose prices remain near 50%.
   */
  async findThetaMarkets(minLiquidity = 0, days = 7): Promise<any[]> {
    const markets = await this.api.getMarkets({ active: true, liquidity_num_min: minLiquidity });
    const now = Date.now();
    const windowMs = days * 24 * 60 * 60 * 1000;
    const theta: any[] = [];
    for (const m of markets) {
      const end = Date.parse(m.end_date || m.endDate || '');
      const price = m.yesPrice ?? m.lastPrice ?? 0;
      if (end && end - now < windowMs && price > 0.3 && price < 0.7) {
        theta.push({ id: m.id, slug: m.slug, price, endDate: m.end_date || m.endDate });
      }
    }
    return theta;
  }

  /**
   * Sum outcome probabilities within each event to surface mispricings that can
   * be combined into synthetic parlays.
   */
  async findParlayMismatches(minLiquidity = 0, threshold = 0.05): Promise<any[]> {
    const markets = await this.api.getMarkets({ active: true, liquidity_num_min: minLiquidity });
    const groups: Record<string, any[]> = {};
    for (const m of markets) {
      const event = m.event_id || m.eventId || m.eventSlug;
      if (!event) continue;
      if (!groups[event]) groups[event] = [];
      groups[event].push(m);
    }
    const opps: any[] = [];
    for (const event of Object.keys(groups)) {
      const group = groups[event];
      if (group.length < 2) continue;
      const sum = group.reduce((s, g) => s + (g.yesPrice ?? g.lastPrice ?? 0), 0);
      if (sum < 1 - threshold || sum > 1 + threshold) {
        opps.push({
          event,
          probabilitySum: sum,
          markets: group.map((g) => ({ id: g.id, slug: g.slug, price: g.yesPrice ?? g.lastPrice ?? 0 })),
        });
      }
    }
    return opps;
  }

  /**
   * Surface user positions with significant unrealized losses that could be
   * harvested for tax purposes. Requires a user address parameter.
   */
  async findTaxLossPositions(user?: string, pnlThreshold = -0.1): Promise<any[]> {
    if (!user) return [];
    const positions = await this.api.getPositions(user, { sizeThreshold: 1 });
    return positions
      .filter((p: any) => typeof p.percentPnl === 'number' && p.percentPnl < pnlThreshold)
      .map((p: any) => ({ market: p.market, percentPnl: p.percentPnl, size: p.size }));
  }

  /**
   * Aggregate platform-wide metrics as a proxy for infrastructure token value.
   */
  async analyzeInfrastructure(): Promise<any[]> {
    const markets = await this.api.getMarkets({ active: true });
    const totalVolume = markets.reduce((sum: number, m: any) => sum + (m.volume || 0), 0);
    return [{ totalVolume, activeMarkets: markets.length }];
  }

  /**
   * Basic Kelly position sizing implementation. The profitMargin represents the
   * expected percentage profit (e.g. 0.05 for 5%), executionProbability is the
   * probability both legs of the trade execute successfully. The returned
   * number is the fraction of total capital to allocate.
   */
  calculateKellyPositionSize(
    profitMargin: number,
    executionProbability: number,
    maxFraction = 0.25
  ): number {
    const q = 1 - executionProbability;
    const b = profitMargin;
    const kelly = (executionProbability * b - q) / b;
    return Math.max(0, Math.min(kelly * maxFraction, maxFraction));
  }
}
