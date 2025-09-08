// @ts-nocheck
import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ApiKeyCreds,
  ClobClient,
  OrderType,
  Side,
  createL2Headers,
  AssetType,
} from "@polymarket/clob-client";
import { ToolResult } from "../types";

// Singleton Polymarket tool to share wallet connection across CLI and agent
export class PolymarketTool {
  private gammaBase = "https://gamma-api.polymarket.com";
  private dataBase = "https://data-api.polymarket.com";
  private clobBase = "https://clob.polymarket.com";
  private signer?: Wallet;
  private clobClient?: ClobClient;
  private apiCreds?: ApiKeyCreds;
  private address?: string;
  private walletPath = path.join(
    os.homedir(),
    ".h1dr4",
    "polymarket-wallet.json"
  );

  // Endpoints known to return 404/405 or otherwise be unsupported
  private brokenEndpoints = new Set([
    "/balance",
    "/orders",
    "/positions",
    "/data/balance",
    "/holdings-value",
    "/user-activity",
    "/market-holders",
    "/spreads",
    "/volume",
    "/liquidity",
    "/stats",
    "/leaderboard",
    "/polls",
    "/trades",
  ]);

  private ensureEndpoint(endpoint: string): string {
    return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  }

  // Parse clobTokenIds which may come as JSON string, single string, or array
  private parseTokenIds(clobTokenIds: any): string[] {
    if (!clobTokenIds) return [];

    if (typeof clobTokenIds === "string") {
      try {
        return JSON.parse(clobTokenIds);
      } catch {
        return [clobTokenIds];
      }
    }

    if (Array.isArray(clobTokenIds)) {
      return clobTokenIds;
    }

    return [];
  }

  private async saveWallet(privateKey: string, creds: ApiKeyCreds) {
    await fs.promises.mkdir(path.dirname(this.walletPath), { recursive: true });
    await fs.promises.writeFile(
      this.walletPath,
      JSON.stringify({
        privateKey,
        apiKey: creds.key,
        apiSecret: creds.secret,
        passphrase: creds.passphrase,
      }),
      "utf-8"
    );
  }

  async connectWallet(
    privateKey: string,
    signatureType = 0,
    funder?: string
  ): Promise<ToolResult> {
    try {
      let Wallet: any;
      ({ Wallet } = await import("ethers"));
      this.signer = new Wallet(privateKey);
      this.address = await this.signer.getAddress();

      // Ethers v6 renamed _signTypedData to signTypedData; add alias for CLOB client
      if (!this.signer._signTypedData && this.signer.signTypedData) {
        this.signer._signTypedData = this.signer.signTypedData.bind(this.signer);
      }

      const args: any[] = [this.clobBase, 137, this.signer];
      if (signatureType > 0 && funder) {
        args.push(undefined, signatureType, funder);
      }
      this.clobClient = new (ClobClient as any)(...args);

      const creds = await this.clobClient.createOrDeriveApiKey();
      if (!creds || !creds.key) {
        throw new Error("Could not create api key");
      }

      console.log(`\u2705 API Key created: ${creds.key}`);

      // set credentials on the existing client without re-instantiating
      (this.clobClient as any).creds = creds;
      this.apiCreds = creds;
      await this.saveWallet(privateKey, creds);
      return {
        success: true,
        output: `\u2705 Connected wallet ${this.address} with API key: ${creds.key}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Wallet connection failed: ${error.message}`,
      };
    }
  }

  private async loadSavedWallet() {
    if (this.signer && this.address && this.apiCreds && this.clobClient) return;
    try {
      const raw = await fs.promises.readFile(this.walletPath, "utf-8");
      const { privateKey, apiKey, apiSecret, passphrase } = JSON.parse(raw);
      if (!privateKey) return;
      let Wallet: any;
      ({ Wallet } = await import("ethers"));
      this.signer = new Wallet(privateKey);
      this.address = await this.signer.getAddress();
      if (!this.signer._signTypedData && this.signer.signTypedData) {
        this.signer._signTypedData = this.signer.signTypedData.bind(this.signer);
      }
      if (apiKey && apiSecret && passphrase) {
        const creds: ApiKeyCreds = {
          key: apiKey,
          secret: apiSecret,
          passphrase,
        };
        this.clobClient = new ClobClient(
          this.clobBase,
          137,
          this.signer,
          creds
        );
        (this.clobClient as any).creds = creds;
        this.apiCreds = creds;
      } else {
        this.clobClient = new ClobClient(this.clobBase, 137, this.signer);
      }
    } catch {
      /* no persisted wallet */
    }
  }

  async gammaRequest(
    endpoint: string,
    params?: Record<string, any>
  ): Promise<ToolResult> {
    try {
      const ep = this.ensureEndpoint(endpoint);
      if (this.brokenEndpoints.has(ep)) {
        return {
          success: false,
          error: `Endpoint ${ep} is unsupported`,
        };
      }
      const response = await axios.get(`${this.gammaBase}${ep}`, { params });
      return {
        success: true,
        data: response.data,
        output: JSON.stringify(response.data),
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Gamma request failed: ${error.message}`,
      };
    }
  }

  async dataRequest(
    endpoint: string,
    params?: Record<string, any>
  ): Promise<ToolResult> {
    try {
      const ep = this.ensureEndpoint(endpoint);
      if (this.brokenEndpoints.has(ep)) {
        return {
          success: false,
          error: `Endpoint ${ep} is unsupported`,
        };
      }
      const response = await axios.get(`${this.dataBase}${ep}`, { params });
      return {
        success: true,
        data: response.data,
        output: JSON.stringify(response.data),
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Data request failed: ${error.message}`,
      };
    }
  }

  private async clobRequest(
    method: "GET" | "POST",
    endpoint: string,
    params?: Record<string, any>,
    body?: any
  ): Promise<ToolResult> {
    await this.loadSavedWallet();
    if (!this.signer || !this.apiCreds) {
      return { success: false, error: "Wallet not connected" };
    }
    try {
      const ep = this.ensureEndpoint(endpoint);
      if (this.brokenEndpoints.has(ep)) {
        return {
          success: false,
          error: `Endpoint ${ep} is unsupported`,
        };
      }
      const query = params
        ? `?${new URLSearchParams(params as any).toString()}`
        : "";
      const requestPath = `${ep}${query}`;
      const bodyStr = body ? JSON.stringify(body) : "";
      const headers = await createL2Headers(this.signer, this.apiCreds, {
        method,
        requestPath,
        body: bodyStr,
      });
      const url = `${this.clobBase}${requestPath}`;
      const response =
        method === "GET"
          ? await axios.get(url, { headers })
          : await axios.post(url, body, { headers });
      return {
        success: true,
        data: response.data,
        output: JSON.stringify(response.data),
      };
    } catch (error: any) {
      return { success: false, error: `CLOB request failed: ${error.message}` };
    }
  }

  async getBalance(
    assetType: AssetType = AssetType.COLLATERAL,
    tokenId?: string
  ): Promise<ToolResult> {
    await this.loadSavedWallet();
    if (!this.clobClient) {
      return { success: false, error: "Wallet not connected" };
    }
    try {
      const resp = await this.clobClient.getBalanceAllowance({
        asset_type: assetType,
        token_id: tokenId,
      });
      return { success: true, data: resp, output: JSON.stringify(resp) };
    } catch (error: any) {
      return {
        success: false,
        error: `Balance request failed: ${error.message}`,
      };
    }
  }

  async getOpenOrders(params?: {
    market?: string;
    assetId?: string;
  }): Promise<ToolResult> {
    await this.loadSavedWallet();
    if (!this.clobClient) {
      return { success: false, error: "Wallet not connected" };
    }
    try {
      const resp = await this.clobClient.getOpenOrders({
        market: params?.market,
        asset_id: params?.assetId,
      });
      return { success: true, data: resp, output: JSON.stringify(resp) };
    } catch (error: any) {
      return {
        success: false,
        error: `Get orders failed: ${error.message}`,
      };
    }
  }

  async getTrades(params?: {
    market?: string;
    assetId?: string;
    maker?: string;
    taker?: string;
  }): Promise<ToolResult> {
    await this.loadSavedWallet();
    if (!this.clobClient) {
      return { success: false, error: "Wallet not connected" };
    }
    try {
      const resp = await this.clobClient.getTrades({
        market: params?.market,
        asset_id: params?.assetId,
        maker: params?.maker,
        taker: params?.taker,
      } as any);
      return { success: true, data: resp, output: JSON.stringify(resp) };
    } catch (error: any) {
      return {
        success: false,
        error: `Get trades failed: ${error.message}`,
      };
    }
  }

  async getOrderBook(tokenId: string): Promise<ToolResult> {
    await this.loadSavedWallet();
    if (!this.clobClient) {
      this.clobClient = new ClobClient(this.clobBase, 137);
    }
    try {
      const resp = await this.clobClient.getOrderBook(tokenId);
      return { success: true, data: resp, output: JSON.stringify(resp) };
    } catch (error: any) {
      return { success: false, error: `Order book failed: ${error.message}` };
    }
  }

  async getPrice(tokenId: string, side: "BUY" | "SELL"): Promise<ToolResult> {
    await this.loadSavedWallet();
    if (!this.clobClient) {
      this.clobClient = new ClobClient(this.clobBase, 137);
    }
    try {
      const resp = await this.clobClient.getPrice(tokenId, side);
      return { success: true, data: resp, output: JSON.stringify(resp) };
    } catch (error: any) {
      return { success: false, error: `Price request failed: ${error.message}` };
    }
  }

  async getSpread(tokenId: string): Promise<ToolResult> {
    await this.loadSavedWallet();
    if (!this.clobClient) {
      this.clobClient = new ClobClient(this.clobBase, 137);
    }
    try {
      const resp = await this.clobClient.getSpread(tokenId);
      return { success: true, data: resp, output: JSON.stringify(resp) };
    } catch (error: any) {
      return { success: false, error: `Spread request failed: ${error.message}` };
    }
  }

  async getLastTradePrice(tokenId: string): Promise<ToolResult> {
    await this.loadSavedWallet();
    if (!this.clobClient) {
      this.clobClient = new ClobClient(this.clobBase, 137);
    }
    try {
      const resp = await this.clobClient.getLastTradePrice(tokenId);
      return { success: true, data: resp, output: JSON.stringify(resp) };
    } catch (error: any) {
      return {
        success: false,
        error: `Last trade price failed: ${error.message}`,
      };
    }
  }

  async getPolls(params?: Record<string, any>): Promise<ToolResult> {
    const merged = { closed: false, ...(params || {}) };
    return this.gammaRequest("/markets", merged);
  }

  async placeOrder(
    tokenId: string,
    price: number,
    size: number,
    side: "buy" | "sell"
  ): Promise<ToolResult> {
    await this.loadSavedWallet();
    if (!this.clobClient) {
      return { success: false, error: "Wallet not connected" };
    }
    try {
      const tickSize = await this.clobClient.getTickSize(tokenId);
      const negRisk = await this.clobClient.getNegRisk(tokenId);

      const orderParams = {
        tokenID: tokenId.toString(),
        price: Number(price),
        size: Number(size),
        side: side === "buy" ? Side.BUY : Side.SELL,
      };

      const marketParams = {
        tickSize: Number(tickSize),
        negRisk: Boolean(negRisk),
      };

      const order = await this.clobClient.createAndPostOrder(
        orderParams,
        marketParams,
        OrderType.GTC
      );
      return {
        success: true,
        data: order,
        output: JSON.stringify(order),
      };
    } catch (error: any) {
      return { success: false, error: `Order failed: ${error.message}` };
    }
  }

  async cancelOrder(orderId: string): Promise<ToolResult> {
    await this.loadSavedWallet();
    if (!this.clobClient) {
      return { success: false, error: "Wallet not connected" };
    }
    try {
      const resp = await this.clobClient.cancelOrder({ orderID: orderId });
      return {
        success: true,
        data: resp,
        output: JSON.stringify(resp),
      };
    } catch (error: any) {
      return { success: false, error: `Cancel failed: ${error.message}` };
    }
  }

  async execute(args: any): Promise<ToolResult> {
    switch (args.operation) {
      case "gamma_request":
        return this.gammaRequest(args.endpoint, args.params);
      case "data_request":
        return this.dataRequest(args.endpoint, args.params);
      case "clob_request":
        return this.clobRequest(
          (args.method || "GET").toUpperCase(),
          args.endpoint,
          args.params,
          args.body
        );
      case "get_balance":
        return this.getBalance(args.assetType as AssetType, args.tokenId);
      case "get_open_orders":
        return this.getOpenOrders({ market: args.market, assetId: args.assetId });
      case "get_trades":
        return this.getTrades({
          market: args.market,
          assetId: args.assetId,
          maker: args.maker,
          taker: args.taker,
        });
      case "get_order_book":
        const obIds = this.parseTokenIds(args.clobTokenIds ?? args.tokenId);
        if (!obIds.length) {
          return { success: false, error: "Token ID required" };
        }
        return this.getOrderBook(obIds[0]);
      case "get_price":
        return this.getPrice(args.tokenId, args.side);
      case "get_spread":
        return this.getSpread(args.tokenId);
      case "get_last_trade_price":
        return this.getLastTradePrice(args.tokenId);
      case "get_polls":
        return this.getPolls(args.params);
      case "place_order":
        const orderIds = this.parseTokenIds(args.clobTokenIds ?? args.tokenId);
        if (!orderIds.length) {
          return { success: false, error: "Token ID required" };
        }
        return this.placeOrder(
          orderIds[0],
          args.price,
          args.size,
          args.side
        );
      case "cancel_order":
        return this.cancelOrder(args.orderId);
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
