import axios, { AxiosRequestConfig } from "axios";
import { ToolResult } from "../types";

type PrimitiveValue = string | number | boolean;
type ParamValue = PrimitiveValue | PrimitiveValue[];

export interface GdeltQueryArgs {
  action: string;
  endpointVersion?: "v1" | "v2";
  params?: Record<string, ParamValue | undefined>;
  timeoutMs?: number;
}

export class GdeltTool {
  private readonly baseUrl = "https://my-search-proxy.ew.r.appspot.com";

  async query(args: GdeltQueryArgs): Promise<ToolResult> {
    const { action, endpointVersion, params, timeoutMs } = args;

    if (!action) {
      return { success: false, error: "Missing required action parameter" };
    }

    try {
      const path = this.getEndpointPath(action, endpointVersion);
      const query = this.buildQueryParams(action, params);
      const url = `${this.baseUrl}${path}`;

      const requestConfig: AxiosRequestConfig = {
        method: "GET",
        url,
        params: query,
        paramsSerializer: {
          serialize: (queryParams) => this.serializeQuery(queryParams as Record<string, ParamValue>),
        },
        timeout: timeoutMs ?? 60000,
      };

      const response = await axios.request(requestConfig);
      return {
        success: true,
        output: JSON.stringify(response.data, null, 2),
        data: response.data,
      };
    } catch (error: any) {
      const message = error?.response?.data
        ? JSON.stringify(error.response.data, null, 2)
        : error?.message || "Unknown error";
      return {
        success: false,
        error: `GDELT request failed: ${message}`,
      };
    }
  }

  private getEndpointPath(action: string, endpointVersion?: "v1" | "v2"): string {
    if (endpointVersion === "v2") {
      return "/gdelt/v2";
    }

    // Certain actions are only available in v2
    if (["bilateral_conflict_coverage", "context"].includes(action)) {
      return "/gdelt/v2";
    }

    return "/gdelt";
  }

  private buildQueryParams(
    action: string,
    params?: Record<string, ParamValue | undefined>
  ): Record<string, ParamValue> {
    const query: Record<string, ParamValue> = { action };
    if (!params) {
      return query;
    }

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }
      query[key] = value;
    }

    return query;
  }

  private serializeQuery(params: Record<string, ParamValue>): string {
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        value.forEach((item) => {
          searchParams.append(key, this.stringifyValue(item));
        });
      } else {
        searchParams.append(key, this.stringifyValue(value));
      }
    }

    return searchParams.toString();
  }

  private stringifyValue(value: PrimitiveValue): string {
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    return String(value);
  }
}
