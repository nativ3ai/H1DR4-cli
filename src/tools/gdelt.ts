import axios, { AxiosError } from "axios";
import { ToolResult } from "../types";

type DatasetVersion = "v1" | "v2";

type GdeltEndpoint =
  | "connection_test"
  | "global_conflict_analysis"
  | "country_risk"
  | "bilateral_relations"
  | "high_impact_events"
  | "economic_events"
  | "custom_date_search"
  | "custom";

export interface GdeltQueryOptions {
  endpoint: GdeltEndpoint;
  datasetVersion?: DatasetVersion;
  /**
   * Optional override for the dataset-relative path. Required when endpoint is "custom".
   * Example: "/custom-path" or "" for the dataset root.
   */
  pathOverride?: string;
  /**
   * Optional HTTP method. Defaults to GET.
   */
  method?: "GET" | "POST";
  /**
   * Query string parameters for GET requests or request body for POST requests.
   */
  parameters?: Record<string, any>;
}

const DEFAULT_BASE_URL = "https://my-search-proxy.ew.r.appspot.com";

const ENDPOINT_PATHS: Record<Exclude<GdeltEndpoint, "custom">, string> = {
  connection_test: "",
  global_conflict_analysis: "/conflict",
  country_risk: "/country-risk",
  bilateral_relations: "/bilateral-relations",
  high_impact_events: "/high-impact-events",
  economic_events: "/economic-events",
  custom_date_search: "/custom-date-search",
};

const DEFAULT_PARAMETERS: Partial<
  Record<Exclude<GdeltEndpoint, "custom">, Record<string, any>>
> = {
  global_conflict_analysis: {
    months: 6,
  },
  country_risk: {
    limit: 20,
  },
  bilateral_relations: {
    months: 6,
  },
  high_impact_events: {
    threshold: 8.0,
    limit: 50,
  },
  custom_date_search: {
    limit: 100,
  },
};

export class GdeltTool {
  private readonly baseURL: string;

  constructor(baseURL?: string) {
    this.baseURL = baseURL || process.env.GDELT_BASE_URL || DEFAULT_BASE_URL;
  }

  async query(options: GdeltQueryOptions): Promise<ToolResult> {
    try {
      const datasetVersion: DatasetVersion = options.datasetVersion || "v1";
      const datasetPath = datasetVersion === "v2" ? "/gdelt/v2" : "/gdelt";
      const endpointPath =
        options.endpoint === "custom"
          ? options.pathOverride ?? null
          : ENDPOINT_PATHS[options.endpoint];

      if (endpointPath == null) {
        return {
          success: false,
          error:
            "Invalid endpoint path. Provide a pathOverride when using the custom endpoint.",
        };
      }

      const url = `${this.baseURL}${datasetPath}${endpointPath}`;
      const method = options.method || "GET";
      const defaultParams =
        options.endpoint === "custom"
          ? {}
          : DEFAULT_PARAMETERS[options.endpoint] || {};
      const parameters = { ...defaultParams, ...(options.parameters || {}) };

      const response = await axios.request({
        method,
        url,
        params: method === "GET" ? parameters : undefined,
        data: method !== "GET" ? parameters : undefined,
        timeout: 20000,
      });

      return {
        success: true,
        output: JSON.stringify(response.data, null, 2),
        data: response.data,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const message =
        axiosError.response?.data && typeof axiosError.response.data === "object"
          ? JSON.stringify(axiosError.response.data, null, 2)
          : axiosError.message;

      return {
        success: false,
        error:
          status != null
            ? `GDELT request failed with status ${status}: ${message}`
            : `Failed to reach GDELT API: ${message}`,
      };
    }
  }
}
