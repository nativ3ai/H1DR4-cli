import React, { useState } from 'react';
import { WagmiConfig, createConfig } from 'wagmi';
import { http } from 'viem';
import { InjectedConnector } from 'wagmi/connectors/injected';
import { base } from 'wagmi/chains';
import Chat from './components/Chat';
import GatedComponent from './components/GatedComponent';
import WalletLogin from './components/WalletLogin';

const config = createConfig({
  chains: [base],
  transports: { [base.id]: http() },
  connectors: [new InjectedConnector()],
});

const App: React.FC = () => {
  const [grokKey, setGrokKey] = useState<string | null>(null);

  return (
    <WagmiConfig config={config}>
      <WalletLogin />
      <GatedComponent onBypass={setGrokKey}>
        <Chat grokKey={grokKey} />
      </GatedComponent>
    </WagmiConfig>
  );
};

export default App;
