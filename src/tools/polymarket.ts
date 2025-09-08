import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import { Wallet } from "@ethersproject/wallet";
import {
  ApiKeyCreds,
  ClobClient,
  OrderType,
  Side,
  createL2Headers,
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

  private ensureEndpoint(endpoint: string): string {
    return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
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
      this.signer = new Wallet(privateKey);
      this.address = await this.signer.getAddress();

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
      this.signer = new Wallet(privateKey);
      this.address = await this.signer.getAddress();
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
      const order = await this.clobClient.createAndPostOrder(
        { tokenID: tokenId, price, size, side: side === "buy" ? Side.BUY : Side.SELL },
        { tickSize, negRisk },
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
      case "place_order":
        return this.placeOrder(
          args.tokenId,
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
