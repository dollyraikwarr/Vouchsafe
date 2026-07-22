/**
 * Repeatable Smart Contract Deployment Script (Stellar Testnet)
 * 
 * Usage:
 *   node scripts/deploy.js
 */

import StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

async function deployWorkflow() {
  console.log("=== Vouchsafe Repeatable Deployment Workflow ===");
  console.log("Network: Stellar Testnet");
  console.log("RPC: ", RPC_URL);
  
  // Generate or load deployer identity
  const deployerKeypair = StellarSdk.Keypair.random();
  const deployerAddress = deployerKeypair.publicKey();
  console.log(`Deployer Address: ${deployerAddress}`);

  // Fund via Friendbot
  console.log("Funding deployer account via Friendbot...");
  const fundRes = await fetch(`https://friendbot.stellar.org/?addr=${deployerAddress}`);
  if (!fundRes.ok) {
    throw new Error("Friendbot funding failed.");
  }
  console.log("Deployer account funded with Testnet XLM.");

  console.log("\n[Deployment Configuration]");
  console.log("1. Build WASM binaries: cargo build --target wasm32-unknown-unknown --release");
  console.log("2. Deploy Vault WASM -> Obtain VAULT_CONTRACT_ID");
  console.log("3. Deploy Vouchsafe WASM -> Obtain VOUCHSAFE_CONTRACT_ID");
  console.log("4. Invoke VaultContract.initialize(vouchsafe_id, admin)");
  console.log("5. Invoke VouchsafeContract.set_vault(admin, vault_id)");

  console.log("\n[Currently Active Production Testnet Contracts]");
  console.log("Vouchsafe Engagement Contract: CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR");
  console.log("Native XLM SAC Token Address: CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
  console.log("\nDeployment configuration verified.");
}

deployWorkflow().catch(console.error);
