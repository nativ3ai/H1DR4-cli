import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { H1dr4Agent } from "../../agent/h1dr4-agent";
import { getSettingsManager } from "../../utils/settings-manager";
import { DEFAULT_OLLAMA_HOST } from "../../utils/config";

interface ApiKeyInputProps {
  onApiKeySet: (agent: H1dr4Agent) => void;
}

export default function ApiKeyInput({ onApiKeySet }: ApiKeyInputProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { exit } = useApp();

  useInput((inputChar, key) => {
    if (isSubmitting) return;

    if (key.ctrl && inputChar === "c") {
      exit();
      return;
    }

    if (key.return) {
      handleSubmit();
      return;
    }


    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      setError("");
      return;
    }

    if (inputChar && !key.ctrl && !key.meta) {
      setInput((prev) => prev + inputChar);
      setError("");
    }
  });


  const handleSubmit = async () => {
    if (!input.trim()) {
      setError("API key cannot be empty");
      return;
    }

    setIsSubmitting(true);
    try {
      const apiKey = input.trim();
      const manager = getSettingsManager();
      const model =
        process.env.H1DR4_MODEL || manager.getCurrentModel() || "grok-4-latest";
      const agent = new H1dr4Agent({
        provider: "remote",
        apiKey,
        baseURL: manager.getBaseURL(),
        model,
        ollamaHost: process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST,
        ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE,
      });

      // Set environment variable for current process
      process.env.GROK_API_KEY = apiKey;
      
      // Save to user settings
      try {
        const manager = getSettingsManager();
        manager.updateUserSetting('apiKey', apiKey);
        console.log(`\n✅ API key saved to ~/.h1dr4/user-settings.json`);
      } catch (error) {
        console.log('\n⚠️ Could not save API key to settings file');
        console.log('API key set for current session only');
      }
      
      onApiKeySet(agent);
    } catch (error: any) {
      setError("Invalid API key format");
      setIsSubmitting(false);
    }
  };

  const displayText = input.length > 0 ? 
    (isSubmitting ? "*".repeat(input.length) : "*".repeat(input.length) + "█") : 
    (isSubmitting ? " " : "█");

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text color="yellow">🔑 Remote API Key Required</Text>
      <Box marginBottom={1}>
        <Text color="gray">Please enter your remote API key to continue:</Text>
      </Box>
      
      <Box borderStyle="round" borderColor="blue" paddingX={1} marginBottom={1}>
        <Text color="gray">❯ </Text>
        <Text>{displayText}</Text>
      </Box>

      {error ? (
        <Box marginBottom={1}>
          <Text color="red">❌ {error}</Text>
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={1}>
        <Text color="gray" dimColor>• Press Enter to submit</Text>
        <Text color="gray" dimColor>• Press Ctrl+C to exit</Text>
        <Text color="gray" dimColor>Note: API key will be saved to ~/.h1dr4/user-settings.json</Text>
      </Box>

      {isSubmitting ? (
        <Box marginTop={1}>
          <Text color="yellow">🔄 Validating API key...</Text>
        </Box>
      ) : null}
    </Box>
  );
}
