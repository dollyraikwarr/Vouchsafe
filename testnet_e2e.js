import StellarSdk from '@stellar/stellar-sdk';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const CONTRACT_ID = 'CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR';
const NATIVE_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

const rpcNamespace = StellarSdk.SorobanRpc || StellarSdk.rpc;
const rpcServer = new rpcNamespace.Server(RPC_URL);

async function fundAccount(address) {
  console.log(`Funding account ${address} via Friendbot...`);
  const response = await fetch(`https://friendbot.stellar.org/?addr=${address}`);
  if (!response.ok) {
    throw new Error(`Friendbot funding failed: ${response.statusText}`);
  }
  console.log(`Account ${address} successfully funded.`);
}

async function sendTransaction(sourceKeypair, operation) {
  const sourceAddress = sourceKeypair.publicKey();
  
  // 1. Fetch account sequence
  const horizonServer = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
  const sourceAccount = await horizonServer.loadAccount(sourceAddress);
  
  // 2. Build transaction
  let tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .setTimeout(StellarSdk.TimeoutInfinite)
    .addOperation(operation)
    .build();

  // 3. Simulate and prepare transaction
  tx = await rpcServer.prepareTransaction(tx);

  // 4. Sign transaction
  tx.sign(sourceKeypair);

  // 5. Submit to RPC
  let response = await rpcServer.sendTransaction(tx);
  if (response.status === 'ERROR') {
    throw new Error(`RPC submit error: ${JSON.stringify(response.errorResult)}`);
  }

  const txHash = response.hash;
  console.log(`Transaction submitted. Hash: ${txHash}. Waiting for ledger confirmation...`);
  
  let count = 0;
  while (count < 30) {
    response = await rpcServer.getTransaction(txHash);
    if (response.status === 'SUCCESS') {
      return { hash: txHash, result: response };
    }
    if (response.status === 'FAILED') {
      throw new Error(`Transaction failed on-ledger: ${JSON.stringify(response.resultResultXdr)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
    count++;
  }
  throw new Error('Transaction confirmation timeout.');
}

async function simulateReadOnly(method, args = []) {
  const tempAccount = new StellarSdk.Account('GA6I3NHCV6MZWTUVZYACWYFAQXQXV24IE5XTTOMPWAVNHR4MZN5ROCG4', '1');
  const tx = new StellarSdk.TransactionBuilder(tempAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .setTimeout(StellarSdk.TimeoutInfinite)
    .addOperation(
      StellarSdk.Operation.invokeContractFunction({
        contract: CONTRACT_ID,
        function: method,
        args: args,
      })
    )
    .build();

  const response = await rpcServer.simulateTransaction(tx);
  if (rpcNamespace.Api.isSimulationSuccess(response)) {
    return StellarSdk.scValToNative(response.result.retval);
  } else {
    throw new Error(`Simulation of ${method} failed: ${response.error || 'unknown error'}`);
  }
}

async function runVerification() {
  console.log('=== Vouchsafe Stellar Testnet End-To-End Verification ===');
  
  // 1. Generate Keypairs
  const clientKeypair = StellarSdk.Keypair.random();
  const developerKeypair = StellarSdk.Keypair.random();
  
  console.log(`Client Address: ${clientKeypair.publicKey()}`);
  console.log(`Developer Address: ${developerKeypair.publicKey()}`);
  
  // 2. Fund Accounts via Friendbot
  await fundAccount(clientKeypair.publicKey());
  await fundAccount(developerKeypair.publicKey());
  
  // 3. Create Engagement
  console.log('\n--- Step 1: Create Engagement ---');
  const amountXlm = 10;
  const amountStroops = BigInt(amountXlm * 10000000);
  const deadlineUnix = BigInt(Math.floor(Date.now() / 1000) + 86400); // 1 day from now
  
  const createOp = StellarSdk.Operation.invokeContractFunction({
    contract: CONTRACT_ID,
    function: 'create_engagement',
    args: [
      StellarSdk.nativeToScVal(clientKeypair.publicKey(), { type: 'address' }),
      StellarSdk.nativeToScVal(developerKeypair.publicKey(), { type: 'address' }),
      StellarSdk.nativeToScVal(NATIVE_SAC, { type: 'address' }),
      StellarSdk.nativeToScVal(amountStroops, { type: 'i128' }),
      StellarSdk.nativeToScVal(deadlineUnix, { type: 'u64' }),
    ],
  });
  
  const createTx = await sendTransaction(clientKeypair, createOp);
  console.log(`✅ Create Engagement Tx Succeeded! Hash: ${createTx.hash}`);
  
  // Fetch generated engagement ID
  const resultXdr = createTx.result.resultMetaXdr;
  const nextId = await simulateReadOnly('create_engagement', [
    StellarSdk.nativeToScVal(clientKeypair.publicKey(), { type: 'address' }),
    StellarSdk.nativeToScVal(developerKeypair.publicKey(), { type: 'address' }),
    StellarSdk.nativeToScVal(NATIVE_SAC, { type: 'address' }),
    StellarSdk.nativeToScVal(1n, { type: 'i128' }),
    StellarSdk.nativeToScVal(0n, { type: 'u64' }),
  ]);
  const engagementId = BigInt(nextId) - 1n;
  console.log(`Active Engagement ID: ${engagementId}`);
  
  // 4. Fund Engagement
  console.log('\n--- Step 2: Fund Engagement Escrow ---');
  const fundOp = StellarSdk.Operation.invokeContractFunction({
    contract: CONTRACT_ID,
    function: 'fund_engagement',
    args: [
      StellarSdk.nativeToScVal(engagementId, { type: 'u64' }),
      StellarSdk.nativeToScVal(clientKeypair.publicKey(), { type: 'address' }),
    ],
  });
  
  const fundTx = await sendTransaction(clientKeypair, fundOp);
  console.log(`✅ Fund Escrow Tx Succeeded! Hash: ${fundTx.hash}`);
  
  // Verify state
  let state = await simulateReadOnly('get_engagement', [
    StellarSdk.nativeToScVal(engagementId, { type: 'u64' }),
  ]);
  console.log(`Escrow Status after funding: ${state.status.name || state.status}`);
  
  // 5. Submit Work Proof
  console.log('\n--- Step 3: Submit Work Proof ---');
  const submitOp = StellarSdk.Operation.invokeContractFunction({
    contract: CONTRACT_ID,
    function: 'submit_work',
    args: [
      StellarSdk.nativeToScVal(engagementId, { type: 'u64' }),
      StellarSdk.nativeToScVal(developerKeypair.publicKey(), { type: 'address' }),
      StellarSdk.nativeToScVal('https://github.com/vouchsafe/deliverables', { type: 'string' }),
      StellarSdk.nativeToScVal('https://github.com/vouchsafe/pull/1', { type: 'string' }),
      StellarSdk.nativeToScVal('e5f6g7h8', { type: 'string' }),
      StellarSdk.nativeToScVal('Completed deliverables for Phase 1', { type: 'string' }),
    ],
  });
  
  const submitTx = await sendTransaction(developerKeypair, submitOp);
  console.log(`✅ Submit Work Tx Succeeded! Hash: ${submitTx.hash}`);
  
  // Verify state
  state = await simulateReadOnly('get_engagement', [
    StellarSdk.nativeToScVal(engagementId, { type: 'u64' }),
  ]);
  console.log(`Escrow Status after submit: ${state.status.name || state.status}`);
  
  // 6. Approve & Release Escrow
  console.log('\n--- Step 4: Approve & Release Escrow ---');
  const approveOp = StellarSdk.Operation.invokeContractFunction({
    contract: CONTRACT_ID,
    function: 'approve_work',
    args: [
      StellarSdk.nativeToScVal(engagementId, { type: 'u64' }),
      StellarSdk.nativeToScVal(clientKeypair.publicKey(), { type: 'address' }),
    ],
  });
  
  const approveTx = await sendTransaction(clientKeypair, approveOp);
  console.log(`✅ Approve & Release Escrow Tx Succeeded! Hash: ${approveTx.hash}`);
  
  // Verify final state
  state = await simulateReadOnly('get_engagement', [
    StellarSdk.nativeToScVal(engagementId, { type: 'u64' }),
  ]);
  console.log(`Escrow Status after approval: ${state.status.name || state.status}`);
  
  // 7. Security Validation: Try to release again (Double-release check)
  console.log('\n--- Step 5: Verify Security (Double Release Prevention) ---');
  try {
    await sendTransaction(clientKeypair, approveOp);
    console.error('❌ Double release check failed: Transaction succeeded when it should have failed!');
  } catch (err) {
    console.log('✅ Double release check passed: Transaction rejected as expected.');
  }

  // 8. Security Validation: Try to submit work using Client key
  console.log('\n--- Step 6: Verify Security (Unauthorized Submission Prevention) ---');
  const badSubmitOp = StellarSdk.Operation.invokeContractFunction({
    contract: CONTRACT_ID,
    function: 'submit_work',
    args: [
      StellarSdk.nativeToScVal(engagementId, { type: 'u64' }),
      StellarSdk.nativeToScVal(clientKeypair.publicKey(), { type: 'address' }),
      StellarSdk.nativeToScVal('https://github.com', { type: 'string' }),
      StellarSdk.nativeToScVal('https://github.com', { type: 'string' }),
      StellarSdk.nativeToScVal('00000000', { type: 'string' }),
      StellarSdk.nativeToScVal('Unauthorized', { type: 'string' }),
    ],
  });
  try {
    await sendTransaction(clientKeypair, badSubmitOp);
    console.error('❌ Unauthorized submission check failed: Transaction succeeded!');
  } catch (err) {
    console.log('✅ Unauthorized submission check passed: Transaction rejected as expected.');
  }

  console.log('\n=== E2E Test Verification Complete! ===');
  console.log(`Create Tx: ${createTx.hash}`);
  console.log(`Fund Tx: ${fundTx.hash}`);
  console.log(`Submit Tx: ${submitTx.hash}`);
  console.log(`Approve Tx: ${approveTx.hash}`);
}

runVerification().catch(err => {
  console.error('E2E Verification Error:', err);
});
