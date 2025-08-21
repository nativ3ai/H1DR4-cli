import axios from "axios";
import { ToolResult } from "../types";

export class OSINTTool {
  async search(query: string): Promise<ToolResult> {
    try {
      const token = process.env.OSINT_TOKEN;
      if (!token) {
        return { success: false, error: "OSINT_TOKEN environment variable not set" };
      }

      const r = await axios.post('https://my-search-proxy.ew.r.appspot.com/leakosint', {
        token,
        request: query,
        limit: 100,
        lang: 'en',
      });

      return { success: true, output: JSON.stringify(r.data, null, 2) };
    } catch (err: any) {
      return { success: false, error: 'Error performing search. Please try again.' };
    }
  }
}
