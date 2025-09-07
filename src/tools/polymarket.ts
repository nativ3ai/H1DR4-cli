import axios from "axios";
import { createConfig } from "@wagmi/core";
import { http, createWalletClient } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ToolResult } from "../types";

// Singleton Polymarket tool to share wallet connection across CLI and agent
export class PolymarketTool {
  private gammaBase = "https://gamma-api.polymarket.com";
  private dataBase = "https://data-api.polymarket.com";
  private clobBase = "https://clob.polymarket.com";
  private walletClient: any = null;
  private address?: `0x${string}`;
  private config = createConfig({
    chains: [polygon],
    transports: { [polygon.id]: http() },
  });

  async connectWallet(privateKey: string): Promise<ToolResult> {
    try {
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      this.walletClient = createWalletClient({
        account,
        chain: polygon,
        transport: http(),
      });
      this.address = account.address;
      return {
        success: true,
        output: `Connected wallet ${account.address}`,
      };
    } catch (error: any) {
      return { success: false, error: `Wallet connection failed: ${error.message}` };
    }
  }

  getAddress(): string | undefined {
    return this.address;
  }

  async getMarkets(): Promise<ToolResult> {
    try {
      const response = await axios.get(`${this.gammaBase}/markets`, {
        params: { active: true },
      });
      return { success: true, data: response.data, output: JSON.stringify(response.data) };
    } catch (error: any) {
      return { success: false, error: `Failed to fetch markets: ${error.message}` };
    }
  }

  async getPositions(userAddress?: string): Promise<ToolResult> {
    const address = userAddress || this.address;
    if (!address) {
      return { success: false, error: "Wallet not connected" };
    }
    try {
      const response = await axios.get(`${this.dataBase}/positions`, {
        params: { user: address },
      });
      return { success: true, data: response.data, output: JSON.stringify(response.data) };
    } catch (error: any) {
      return { success: false, error: `Failed to fetch positions: ${error.message}` };
    }
  }

  async placeOrder(
    marketId: string,
    outcome: string,
    side: "buy" | "sell",
    price: number,
    size: number
  ): Promise<ToolResult> {
    if (!this.walletClient || !this.address) {
      return { success: false, error: "Wallet not connected" };
    }
    try {
      const order = { marketId, outcome, side, price, size, address: this.address };
      const signature = await this.walletClient.signMessage({
        account: this.address,
        message: JSON.stringify(order),
      });
      const response = await axios.post(`${this.clobBase}/orders`, {
        ...order,
        signature,
      });
      return { success: true, data: response.data, output: JSON.stringify(response.data) };
    } catch (error: any) {
      return { success: false, error: `Order failed: ${error.message}` };
    }
  }

  async execute(args: any): Promise<ToolResult> {
    switch (args.operation) {
      case "get_markets":
        return this.getMarkets();
      case "get_positions":
        return this.getPositions(args.userAddress);
      case "place_order":
        return this.placeOrder(
          args.marketId,
          args.outcome,
          args.side,
          args.price,
          args.size
        );
      default:
        return { success: false, error: `Unknown operation ${args.operation}` };
    }
  }
}

let instance: PolymarketTool | null = null;
export function getPolymarketTool(): PolymarketTool {
  if (!instance) instance = new PolymarketTool();
  return instance;
}

