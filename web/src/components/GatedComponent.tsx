import React from 'react';
import { useAccount, useReadContract } from 'wagmi';

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

const GatedComponent: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { address, isConnected } = useAccount();

  const { data: decimalsData, isLoading: loadingDecimals } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'decimals',
    enabled: isConnected,
  });

  const { data: heldBalance, isLoading: loadingHeld } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: 'balanceOf',
    args: [address],
    enabled: !!address && isConnected,
  });

  const { data: stakedBalance, isLoading: loadingStaked } = useReadContract({
    address: STAKING_VAULT,
    abi: STAKING_ABI,
    functionName: 'balanceOf',
    args: [address],
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
    return <div>Access denied. Need ≥500k held or ≥100k staked H1DR4.</div>;

  return <>{children}</>;
};

export default GatedComponent;
