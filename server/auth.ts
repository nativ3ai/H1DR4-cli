import { ethers } from 'ethers';

const TOKEN_ADDRESS = '0x83abfc4beec2ecf12995005d751a42df691c09c1';
const STAKING_VAULT = '0xd1246d1dfcebaf491ee612448cdca8ea6df700fa';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

const STAKING_ABI = [
  'function balanceOf(address account) view returns (uint256)'
];

const provider = new ethers.providers.JsonRpcProvider(process.env.BASE_RPC_URL || 'https://mainnet.base.org');

export async function hasAccess(address: string): Promise<boolean> {
  const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, provider);
  const decimals: number = await token.decimals();
  const holdThreshold = ethers.utils.parseUnits('500000', decimals);
  const stakedThreshold = ethers.utils.parseUnits('100000', decimals);
  const heldBalance = await token.balanceOf(address);
  if (heldBalance.gte(holdThreshold)) return true;
  const staking = new ethers.Contract(STAKING_VAULT, STAKING_ABI, provider);
  const stakedBalance = await staking.balanceOf(address);
  return stakedBalance.gte(stakedThreshold);
}
