import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import { ToolResult } from "../types";

// Singleton Polymarket tool to share wallet connection across CLI and agent
export class PolymarketTool {
  private gammaBase = "https://gamma-api.polymarket.com";
  private dataBase = "https://data-api.polymarket.com";
  private clobBase = "https://clob.polymarket.com";
  private walletClient: any = null;
  private address?: `0x${string}`;
  private walletPath = path.join(os.homedir(), ".h1dr4", "polymarket-wallet.json");

  // Dependencies loaded lazily to avoid CommonJS/ESM interop issues
  private deps: any | null = null;

  private async loadDeps() {
    if (this.deps) return;
    const wagmi = await new Function("return import('@wagmi/core')")();
    const viem = await new Function("return import('viem')")();
    const chains = await new Function("return import('viem/chains')")();
    const accounts = await new Function("return import('viem/accounts')")();
    this.deps = {
      createConfig: wagmi.createConfig,
      http: viem.http,
      createWalletClient: viem.createWalletClient,
      polygon: chains.polygon,
      privateKeyToAccount: accounts.privateKeyToAccount,
    };
  }

  async connectWallet(privateKey: string): Promise<ToolResult> {
    try {
      await this.loadDeps();
      const { privateKeyToAccount, createWalletClient, polygon, http } = this
        .deps!;
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      this.walletClient = createWalletClient({
        account,
        chain: polygon,
        transport: http(),
      });
      this.address = account.address;
      await fs.promises.mkdir(path.dirname(this.walletPath), { recursive: true });
      await fs.promises.writeFile(this.walletPath, JSON.stringify({ privateKey }), "utf-8");
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
        params: { closed: false, order: "volume", ascending: false },
      });
      return { success: true, data: response.data, output: JSON.stringify(response.data) };
    } catch (error: any) {
      return { success: false, error: `Failed to fetch markets: ${error.message}` };
    }
  }

  private async loadSavedWallet() {
    if (this.walletClient && this.address) return;
    try {
      const raw = await fs.promises.readFile(this.walletPath, "utf-8");
      const { privateKey } = JSON.parse(raw);
      if (privateKey) {
        await this.connectWallet(privateKey);
      }
    } catch {
      /* no persisted wallet */
    }
  }

  async getPositions(userAddress?: string): Promise<ToolResult> {
    await this.loadSavedWallet();
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
    await this.loadSavedWallet();
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

