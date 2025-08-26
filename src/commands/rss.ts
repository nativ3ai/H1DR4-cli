import { Command } from "commander";
import chalk from "chalk";
import { addRSSFeed, removeRSSFeed, loadRSSConfig } from "../rss/config";

export function createRSSCommand(): Command {
  const rssCommand = new Command("rss");
  rssCommand.description("Manage RSS feeds");

  rssCommand
    .command("add <name> <url>")
    .description("Add an RSS feed")
    .action((name: string, url: string) => {
      addRSSFeed(name, url);
      console.log(chalk.green(`✓ Added RSS feed: ${name}`));
    });

  rssCommand
    .command("remove <name>")
    .description("Remove an RSS feed")
    .action((name: string) => {
      removeRSSFeed(name);
      console.log(chalk.green(`✓ Removed RSS feed: ${name}`));
    });

  rssCommand
    .command("list")
    .description("List RSS feeds")
    .action(() => {
      const feeds = loadRSSConfig();
      const names = Object.keys(feeds);
      if (names.length === 0) {
        console.log(chalk.yellow("No RSS feeds configured"));
        return;
      }
      console.log(chalk.bold("RSS feeds:"));
      names.forEach((n) => console.log(`- ${n}: ${feeds[n]}`));
    });

  return rssCommand;
}
