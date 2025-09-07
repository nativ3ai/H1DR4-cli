import { Command } from "commander";
import { getPolymarketTool } from "../tools/polymarket";

export function createPolymarketCommand(): Command {
  const pmCommand = new Command("polymarket");
  pmCommand.description("Interact with Polymarket and manage wallet");

  pmCommand
    .command("connect-wallet")
    .description("Connect a wallet using a private key (MetaMask or other)")
    .requiredOption("-k, --private-key <key>", "Private key for the wallet")
    .action(async (options) => {
      try {
        const tool = getPolymarketTool();
        const result = await tool.connectWallet(options.privateKey);
        if (result.success) {
          console.log(result.output);
        } else {
          console.error(result.error);
          process.exit(1);
        }
      } catch (error: any) {
        console.error(`Failed to connect wallet: ${error.message}`);
        process.exit(1);
      }
    });

  return pmCommand;
}

