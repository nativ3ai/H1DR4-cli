import React, { useState } from 'react';
import { useAccount, useContractRead } from 'wagmi';
import { base } from 'wagmi/chains';

const TOKEN_ADDRESS = '0x83abfc4beec2ecf12995005d751a42df691c09c1';

export const CONTRACT_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const STAKING_VAULT = '0xd1246d1dfcebaf491ee612448cdca8ea6df700fa' as const;
const STAKING_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const HOLD_AMOUNT = 500_000n;
const STAKED_AMOUNT = 100_000n;

interface Props {
  children: React.ReactNode;
  onBypass: (key: string) => void;
}

const GatedComponent: React.FC<Props> = ({ children, onBypass }) => {
  const { address, isConnected } = useAccount();
  const [key, setKey] = useState('');

  const { data: decimalsData, isLoading: loadingDecimals } = useContractRead({
    address: TOKEN_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'decimals',
    chainId: base.id,
    enabled: isConnected,
  });

  const { data: heldBalance, isLoading: loadingHeld } = useContractRead({
    address: TOKEN_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'balanceOf',
    args: [address],
    chainId: base.id,
    enabled: !!address && isConnected,
  });

  const { data: stakedBalance, isLoading: loadingStaked } = useContractRead({
    address: STAKING_VAULT,
    abi: STAKING_ABI,
    functionName: 'balanceOf',
    args: [address],
    chainId: base.id,
    enabled: !!address && isConnected,
  });

  const decimals = decimalsData ? Number(decimalsData) : 0;
  const holdThreshold = HOLD_AMOUNT * (10n ** BigInt(decimals));
  const stakedThreshold = STAKED_AMOUNT * (10n ** BigInt(decimals));

  const holdsEnough = heldBalance ? heldBalance >= holdThreshold : false;
  const stakesEnough = stakedBalance ? stakedBalance >= stakedThreshold : false;

  if (loadingDecimals || loadingHeld || loadingStaked) return <div>Loading...</div>;
  if (!isConnected) return <div>Please connect your wallet.</div>;
  if (!(holdsEnough || stakesEnough))
    return (
      <div>
        <p>Access denied. Need ≥500k held or ≥100k staked H1DR4.</p>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Enter Grok API key"
        />
        <button onClick={() => onBypass(key)}>Use Key</button>
      </div>
    );

  return <>{children}</>;
};

export default GatedComponent;
