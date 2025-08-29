import axios, { AxiosInstance } from 'axios';

export interface MarketParams {
  [key: string]: any;
}

export interface OrderRequest {
  market: string;
  outcome: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
}

export class PolymarketAPI {
  private gammaBase = 'https://gamma-api.polymarket.com';
  private dataBase = 'https://data-api.polymarket.com';
  private clobBase = 'https://clob.polymarket.com';
  private client: AxiosInstance;
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.client = axios.create();
    this.apiKey = apiKey || process.env.POLYMARKET_API_KEY;
  }

  async getMarkets(params: MarketParams = {}): Promise<any> {
    const res = await this.client.get(`${this.gammaBase}/markets`, { params });
    return res.data;
  }

  async getPositions(user: string, params: MarketParams = {}): Promise<any> {
    const res = await this.client.get(`${this.dataBase}/positions`, {
      params: { user, ...params },
    });
    return res.data;
  }

  async getPortfolioValue(user: string, market?: string): Promise<any> {
    const res = await this.client.get(`${this.dataBase}/value`, {
      params: { user, market },
    });
    return res.data;
  }

  async placeOrder(order: OrderRequest): Promise<any> {
    if (!this.apiKey) {
      throw new Error('POLYMARKET_API_KEY not set');
    }
    const res = await this.client.post(`${this.clobBase}/orders`, order, {
      headers: { 'X-API-Key': this.apiKey },
    });
    return res.data;
  }
}
