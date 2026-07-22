/**
 * Vouchsafe — Yellow Belt app.js
 * Multi-wallet, deployed Soroban contract, tx state machine,
 * classified error handling, deduplicated event timeline.
 */

import StellarSdk from "@stellar/stellar-sdk";
import { StellarWalletsKit, WalletNetwork, allowAllModules } from "@creit.tech/stellar-wallets-kit";

// ============================================================
// CONFIGURATION
// ============================================================
const HORIZON_URL       = "https://horizon-testnet.stellar.org";
const RPC_URL           = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const DEFAULT_CONTRACT_ID = "CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR";

// ============================================================
// INFRASTRUCTURE
// ============================================================
const rpcNamespace   = StellarSdk.SorobanRpc || StellarSdk.rpc;
const horizonServer  = new StellarSdk.Horizon.Server(HORIZON_URL);
const rpcServer      = new rpcNamespace.Server(RPC_URL);

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: allowAllModules(),
});

// ============================================================
// APPLICATION STATE
// ============================================================

// ---- Multi-wallet slots ----
// Each slot: { address: string|null, providerId: string|null }
let clientWallet    = { address: null, providerId: null };
let developerWallet = { address: null, providerId: null };

// ---- Engagement state ----
let activeContractId    = DEFAULT_CONTRACT_ID;
let engagementsList     = [];
let selectedEngagement  = null;
let currentRole         = "client"; // "client" | "developer"

// ---- Event deduplication ----
// Key = txHash + ":" + eventType + ":" + engagementId
const displayedEventKeys = new Set();
let lastCheckedLedger    = 0;
let eventInterval        = null;

const $ = (id) => document.getElementById(id);

// ============================================================
// STEP 1 — TRANSACTION STATE MACHINE
// States: IDLE | AWAITING_WALLET_APPROVAL | SUBMITTING | PENDING_CONFIRMATION | SUCCESS | FAILED
// ============================================================
const TxState = Object.freeze({
  IDLE:                  "IDLE",
  AWAITING_WALLET:       "AWAITING_WALLET_APPROVAL",
  SUBMITTING:            "SUBMITTING",
  PENDING_CONFIRMATION:  "PENDING_CONFIRMATION",
  SUCCESS:               "SUCCESS",
  FAILED:                "FAILED",
});

const TX_STATE_CONFIG = {
  [TxState.IDLE]:                { icon: "",   cls: "",        label: ""                                           },
  [TxState.AWAITING_WALLET]:     { icon: "🔐",  cls: "loading", label: "Waiting for wallet approval…"              },
  [TxState.SUBMITTING]:          { icon: "📡",  cls: "loading", label: "Submitting transaction to Stellar Testnet…" },
  [TxState.PENDING_CONFIRMATION]:{ icon: "⏳",  cls: "loading", label: "Waiting for on-chain confirmation…"        },
  [TxState.SUCCESS]:             { icon: "✅",  cls: "success", label: "Transaction confirmed!"                    },
  [TxState.FAILED]:              { icon: "❌",  cls: "error",   label: "Transaction failed."                       },
};

/**
 * Central UI update for transaction lifecycle.
 * @param {string} state — one of TxState.*
 * @param {{ message?: string, hash?: string, error?: string }} opts
 */
function setTxState(state, opts = {}) {
  const banner   = $("statusBanner");
  const iconEl   = $("statusIcon");
  const textEl   = $("statusText");
  const hashRow  = $("txStateHash");
  const linkEl   = $("txStateLink");
  const errorRow = $("txStateError");
  const stepsEl  = $("txStateSteps");

  if (!banner) return;

  const cfg = TX_STATE_CONFIG[state] || TX_STATE_CONFIG[TxState.IDLE];

  // Reset
  banner.classList.remove("hidden", "success", "error", "loading");
  if (iconEl) { iconEl.className = ""; iconEl.innerHTML = ""; }
  if (hashRow)  hashRow.classList.add("hidden");
  if (linkEl)   linkEl.classList.add("hidden");
  if (errorRow) errorRow.classList.add("hidden");

  if (state === TxState.IDLE) {
    banner.classList.add("hidden");
    // Update step indicator to IDLE
    updateTxStepUI(0);
    return;
  }

  banner.classList.add(cfg.cls || "loading");

  if (iconEl) {
    if (cfg.cls === "loading") {
      iconEl.className = "spinner";
      iconEl.innerHTML = "";
    } else {
      iconEl.innerHTML = cfg.icon;
    }
  }

  const displayMsg = opts.message || cfg.label;
  if (textEl) textEl.textContent = displayMsg;

  // Hash + explorer link after success
  if (state === TxState.SUCCESS && opts.hash) {
    if (hashRow) {
      hashRow.classList.remove("hidden");
      hashRow.innerHTML = `<span class="monospace" style="font-size:0.8rem;word-break:break-all;">Tx: ${opts.hash}</span>`;
    }
    if (linkEl) {
      linkEl.href = `https://stellar.expert/explorer/testnet/tx/${opts.hash}`;
      linkEl.classList.remove("hidden");
    }
  }

  // Error row after failure
  if (state === TxState.FAILED && opts.error) {
    if (errorRow) {
      errorRow.classList.remove("hidden");
      errorRow.textContent = opts.error;
    }
  }

  // Step progress indicator
  const stateOrder = [TxState.AWAITING_WALLET, TxState.SUBMITTING, TxState.PENDING_CONFIRMATION, TxState.SUCCESS];
  const stepIdx = stateOrder.indexOf(state);
  updateTxStepUI(stepIdx + 1);
}

function updateTxStepUI(activeStep) {
  const steps = $("txStateSteps");
  if (!steps) return;
  steps.querySelectorAll(".tx-step").forEach((el, idx) => {
    el.classList.remove("tx-step-active", "tx-step-done");
    if (idx < activeStep) el.classList.add("tx-step-done");
    else if (idx === activeStep) el.classList.add("tx-step-active");
  });
}

// ============================================================
// STEP 2 — ERROR CLASSIFICATION
// Prioritises: error codes → wallet-specific flags → message text
// ============================================================

/**
 * Error types returned by classifyError()
 */
const ErrorType = Object.freeze({
  WALLET_UNAVAILABLE:    "WALLET_UNAVAILABLE",
  USER_REJECTED:         "USER_REJECTED",
  INSUFFICIENT_BALANCE:  "INSUFFICIENT_BALANCE",
  WRONG_ROLE:            "WRONG_ROLE",
  INVALID_STATE:         "INVALID_STATE",
  WRONG_NETWORK:         "WRONG_NETWORK",
  RPC_FAILURE:           "RPC_FAILURE",
  TX_TIMEOUT:            "TX_TIMEOUT",
  UNKNOWN:               "UNKNOWN",
});

/**
 * Classify an error into a typed, user-friendly object.
 * Inspects error codes first, falls back to message text.
 * @param {Error|any} err
 * @returns {{ type: string, title: string, message: string, action: string }}
 */
function classifyError(err) {
  // 1. Horizon result codes (tx/op level)
  const resultCodes = err?.response?.data?.extras?.result_codes;
  if (resultCodes) {
    const opCodes = resultCodes.operations || [];
    const txCode  = resultCodes.transaction || "";

    if (opCodes.includes("op_underfunded") || txCode === "tx_insufficient_balance") {
      return {
        type:    ErrorType.INSUFFICIENT_BALANCE,
        title:   "Insufficient Balance",
        message: "Your wallet does not have enough XLM or tokens to fund this transaction.",
        action:  "Fund your Testnet wallet at https://laboratory.stellar.org or use Friendbot.",
      };
    }
    if (opCodes.includes("op_no_trust")) {
      return {
        type:    ErrorType.INSUFFICIENT_BALANCE,
        title:   "Token Not Trusted",
        message: "Your wallet has not established a trustline for this token.",
        action:  "Add a trustline for the token before funding.",
      };
    }
    if (txCode === "tx_bad_auth" || opCodes.includes("op_bad_auth")) {
      return {
        type:    ErrorType.USER_REJECTED,
        title:   "Authorization Failed",
        message: "The transaction was not properly authorized. You may have signed with the wrong wallet.",
        action:  "Make sure you are signing with the correct role wallet.",
      };
    }
    if (txCode === "tx_insufficient_fee") {
      return {
        type:    ErrorType.INSUFFICIENT_BALANCE,
        title:   "Fee Too Low",
        message: "The transaction fee was too low to be accepted by the network.",
        action:  "Try again — the app will use a higher fee automatically.",
      };
    }
    // Any other Horizon error
    return {
      type:    ErrorType.UNKNOWN,
      title:   "Transaction Failed",
      message: `Network error: ${JSON.stringify(resultCodes)}`,
      action:  "Check your balance and try again.",
    };
  }

  // 2. RPC simulation / contract errors
  const rpcError = err?.response?.error || err?.error;
  if (rpcError) {
    const rpcMsg = String(rpcError).toLowerCase();
    if (rpcMsg.includes("invalid state") || rpcMsg.includes("not in") || rpcMsg.includes("status")) {
      return {
        type:    ErrorType.INVALID_STATE,
        title:   "Invalid Contract State",
        message: "This action cannot be performed — the engagement is not in the required state.",
        action:  "Refresh the engagement list and verify the current status.",
      };
    }
    if (rpcMsg.includes("caller must be") || rpcMsg.includes("require_auth")) {
      return {
        type:    ErrorType.WRONG_ROLE,
        title:   "Wrong Role / Authorization",
        message: "You are not authorized to perform this action on this engagement.",
        action:  "Connect the correct wallet for this role (client or developer).",
      };
    }
  }

  // 3. Wallet-specific error codes and flags
  const errMsg = String(err?.message || err || "").toLowerCase();

  // Wallet Kit sets err.code for known wallet errors
  const errCode = err?.code;
  if (errCode === -1 || errCode === 4001 || errMsg.includes("user rejected") ||
      errMsg.includes("user denied") || errMsg.includes("cancelled by user") ||
      errMsg.includes("closed by user") || errMsg.includes("request rejected")) {
    return {
      type:    ErrorType.USER_REJECTED,
      title:   "Transaction Cancelled",
      message: "You rejected the transaction in your wallet.",
      action:  "Click the action button again if you'd like to try.",
    };
  }

  if (errMsg.includes("no wallet") || errMsg.includes("not installed") ||
      errMsg.includes("extension not found") || errMsg.includes("wallet not found") ||
      errMsg.includes("wallet is not available") || errMsg.includes("provider not found") ||
      errCode === "NO_WALLET") {
    return {
      type:    ErrorType.WALLET_UNAVAILABLE,
      title:   "Wallet Not Available",
      message: "The selected wallet is not installed or cannot be accessed.",
      action:  "Install the wallet extension, or choose a different wallet provider (Albedo works without an extension).",
    };
  }

  if (errMsg.includes("insufficient") || errMsg.includes("balance") || errMsg.includes("underfunded")) {
    return {
      type:    ErrorType.INSUFFICIENT_BALANCE,
      title:   "Insufficient Balance",
      message: "Your wallet does not have enough funds for this transaction.",
      action:  "Fund your Testnet wallet using Stellar Friendbot.",
    };
  }

  if (errMsg.includes("network mismatch") || errMsg.includes("wrong network") ||
      errMsg.includes("mainnet") || errMsg.includes("network passphrase")) {
    return {
      type:    ErrorType.WRONG_NETWORK,
      title:   "Wrong Network",
      message: "Your wallet is connected to the wrong Stellar network.",
      action:  "Switch your wallet to Stellar Testnet.",
    };
  }

  if (errMsg.includes("timeout") || errMsg.includes("timed out")) {
    return {
      type:    ErrorType.TX_TIMEOUT,
      title:   "Transaction Timeout",
      message: "The transaction was submitted but did not confirm within the expected time.",
      action:  "Check the Activity tab for updates, or verify on Stellar Explorer.",
    };
  }

  if (errMsg.includes("rpc") || errMsg.includes("network") || errMsg.includes("fetch")) {
    return {
      type:    ErrorType.RPC_FAILURE,
      title:   "Network Error",
      message: "Could not reach the Stellar Testnet RPC. Check your internet connection.",
      action:  "Try again in a few seconds.",
    };
  }

  // 4. Contract assertion messages (from Soroban contract panics)
  if (errMsg.includes("caller must be the client")) {
    return {
      type:    ErrorType.WRONG_ROLE,
      title:   "Wrong Role",
      message: "This action must be performed by the client wallet. You signed with the wrong wallet.",
      action:  "Connect your client wallet and try again.",
    };
  }
  if (errMsg.includes("caller must be the developer")) {
    return {
      type:    ErrorType.WRONG_ROLE,
      title:   "Wrong Role",
      message: "This action must be performed by the developer wallet. You signed with the wrong wallet.",
      action:  "Connect your developer wallet and try again.",
    };
  }
  if (errMsg.includes("invalid state")) {
    return {
      type:    ErrorType.INVALID_STATE,
      title:   "Invalid Contract State",
      message: "This action cannot be performed — the engagement is not in the required state.",
      action:  "Refresh the list and check the current engagement status.",
    };
  }

  // 5. Fallback
  return {
    type:    ErrorType.UNKNOWN,
    title:   "Unexpected Error",
    message: err?.message || String(err) || "An unexpected error occurred.",
    action:  "Please try again or check the browser console for details.",
  };
}

/** Show a classified error in the transaction status banner. */
function showClassifiedError(err) {
  const classified = classifyError(err);
  setTxState(TxState.FAILED, {
    message: `${classified.title}: ${classified.message}`,
    error:   classified.action,
  });
  console.error("[Vouchsafe Error]", classified.type, err);
}

// ============================================================
// STEP 3 — MULTI-WALLET ROLE SYSTEM WITH SIGNING GUARDS
// ============================================================

/** Returns the wallet slot for a given role. */
function getWalletSlot(role) {
  return role === "client" ? clientWallet : developerWallet;
}

/**
 * Ensure the correct role wallet is connected and switch the kit to it.
 * Throws a WRONG_ROLE error if the wallet is not connected for the expected role.
 * @param {"client"|"developer"} requiredRole
 * @returns {string} The signer address
 */
async function requireSigningWallet(requiredRole) {
  const slot = getWalletSlot(requiredRole);

  if (!slot.address || !slot.providerId) {
    const err = new Error(`Please connect your ${requiredRole} wallet first.`);
    err.code = "NO_WALLET";
    throw err;
  }

  // Switch the kit to the role's wallet provider
  kit.setWallet(slot.providerId);

  return slot.address;
}

/**
 * Open wallet modal for a specific role. Stores to the right slot.
 * @param {"client"|"developer"} role
 */
async function connectWalletForRole(role) {
  try {
    setTxState(TxState.AWAITING_WALLET, { message: `Opening wallet selection for ${role}…` });

    await kit.openModal({
      onWalletSelected: async (option) => {
        try {
          kit.setWallet(option.id);
          const { address } = await kit.getAddress();

          if (role === "client") {
            clientWallet = { address, providerId: option.id };
          } else {
            developerWallet = { address, providerId: option.id };
          }

          updateWalletUI();
          setTxState(TxState.IDLE);

          // Refresh balance for the active role
          await refreshRoleBalance(role, address);

          // Load engagements if any wallet is connected
          loadLocalStorageConfig();
          await loadEngagements();
        } catch (err) {
          showClassifiedError(err);
        }
      },
    });
    setTxState(TxState.IDLE);
  } catch (err) {
    showClassifiedError(err);
  }
}

/** Disconnect a specific role wallet. */
function disconnectWalletForRole(role) {
  if (role === "client") {
    clientWallet = { address: null, providerId: null };
  } else {
    developerWallet = { address: null, providerId: null };
  }
  updateWalletUI();
}

/** Update both wallet slot UIs. */
function updateWalletUI() {
  // Client slot
  const clientAddr   = $("clientWalletAddress");
  const clientBadge  = $("clientWalletBadge");
  const clientConnBtn  = $("connectClientBtn");
  const clientDiscBtn  = $("disconnectClientBtn");

  if (clientWallet.address) {
    if (clientAddr)   clientAddr.textContent = truncateAddr(clientWallet.address);
    if (clientBadge)  clientBadge.classList.remove("hidden");
    if (clientConnBtn)  clientConnBtn.classList.add("hidden");
    if (clientDiscBtn)  clientDiscBtn.classList.remove("hidden");
  } else {
    if (clientAddr)   clientAddr.textContent = "Not Connected";
    if (clientBadge)  clientBadge.classList.add("hidden");
    if (clientConnBtn)  clientConnBtn.classList.remove("hidden");
    if (clientDiscBtn)  clientDiscBtn.classList.add("hidden");
  }

  // Developer slot
  const devAddr    = $("developerWalletAddress");
  const devBadge   = $("developerWalletBadge");
  const devConnBtn   = $("connectDeveloperBtn");
  const devDiscBtn   = $("disconnectDeveloperBtn");

  if (developerWallet.address) {
    if (devAddr)   devAddr.textContent = truncateAddr(developerWallet.address);
    if (devBadge)  devBadge.classList.remove("hidden");
    if (devConnBtn)  devConnBtn.classList.add("hidden");
    if (devDiscBtn)  devDiscBtn.classList.remove("hidden");
  } else {
    if (devAddr)   devAddr.textContent = "Not Connected";
    if (devBadge)  devBadge.classList.add("hidden");
    if (devConnBtn)  devConnBtn.classList.remove("hidden");
    if (devDiscBtn)  devDiscBtn.classList.add("hidden");
  }

  // Network badge — show if either wallet connected
  const networkBadge = $("networkBadge");
  if (networkBadge) {
    if (clientWallet.address || developerWallet.address) {
      networkBadge.classList.remove("hidden");
    } else {
      networkBadge.classList.add("hidden");
    }
  }
}

async function refreshRoleBalance(role, address) {
  try {
    const account = await horizonServer.loadAccount(address);
    const nativeBal = account.balances.find(b => b.asset_type === "native");
    const balance = nativeBal ? Number(nativeBal.balance).toFixed(4) : "0.0000";
    const elId = role === "client" ? "clientWalletBalance" : "developerWalletBalance";
    const el = $(elId);
    if (el) el.textContent = `${balance} XLM`;
  } catch (err) {
    if (err?.response?.status === 404) {
      const elId = role === "client" ? "clientWalletBalance" : "developerWalletBalance";
      const el = $(elId);
      if (el) el.textContent = "0.0000 XLM (Unfunded)";
    }
  }
}

// Keep legacy balance refresh for the "active" role
async function refreshUserBalance() {
  const activeSlot = getWalletSlot(currentRole);
  if (activeSlot.address) {
    await refreshRoleBalance(currentRole, activeSlot.address);
  }
}

// ============================================================
// CONTRACT INTERACTION HELPERS
// ============================================================

function stroopsToXlm(stroops) {
  return (Number(stroops) / 10000000).toFixed(2);
}

function xlmToStroops(xlm) {
  return BigInt(Math.round(Number(xlm) * 10000000));
}

function truncateAddr(addr) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

/** Simulate-only read (no signing needed). */
async function simulateReadOnly(contractId, method, scArgs = []) {
  const tempAccount = new StellarSdk.Account("GA6I3NHCV6MZWTUVZYACWYFAQXQXV24IE5XTTOMPWAVNHR4MZN5ROCG4", "1");
  const tx = new StellarSdk.TransactionBuilder(tempAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .setTimeout(StellarSdk.TimeoutInfinite)
    .addOperation(
      StellarSdk.Operation.invokeContractFunction({
        contract: contractId,
        function: method,
        args: scArgs,
      })
    )
    .build();

  const response = await rpcServer.simulateTransaction(tx);
  if (rpcNamespace.Api.isSimulationSuccess(response)) {
    return StellarSdk.scValToNative(response.result.retval);
  }
  throw new Error(`Simulation failed for ${method}: ${response.error || "unknown"}`);
}

/**
 * Full contract write: build → simulate → sign (with role guard) → submit → confirm.
 * @param {string} contractId
 * @param {string} method
 * @param {Array} scArgs
 * @param {"client"|"developer"} signerRole — role whose wallet must sign
 */
async function invokeContractViaKit(contractId, method, scArgs = [], signerRole = "client") {
  // SIGNING GUARD — verify correct wallet is connected before any UI state change
  const signerAddress = await requireSigningWallet(signerRole);

  setTxState(TxState.AWAITING_WALLET, {
    message: `Preparing ${method} — waiting for ${signerRole} wallet approval…`,
  });

  const sourceAccount = await horizonServer.loadAccount(signerAddress);

  let tx = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .setTimeout(StellarSdk.TimeoutInfinite)
    .addOperation(
      StellarSdk.Operation.invokeContractFunction({
        contract: contractId,
        function: method,
        args: scArgs,
      })
    )
    .build();

  tx = await rpcServer.prepareTransaction(tx);

  // Sign — kit is already set to the correct provider by requireSigningWallet
  const { signedTxXdr } = await kit.signTransaction(tx.toXDR(), {
    address: signerAddress,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);

  setTxState(TxState.SUBMITTING);
  let response = await rpcServer.sendTransaction(signedTx);

  if (response.status === "ERROR") {
    throw new Error(`RPC submit error: ${JSON.stringify(response.errorResult)}`);
  }

  const txHash = response.hash;
  setTxState(TxState.PENDING_CONFIRMATION, {
    message: `Transaction submitted. Awaiting on-chain confirmation…`,
  });

  let count = 0;
  while (count < 30) {
    response = await rpcServer.getTransaction(txHash);
    if (response.status === "SUCCESS") {
      setTxState(TxState.SUCCESS, { hash: txHash });
      addEventToTimeline(method.toUpperCase(), txHash, null, "direct-call");
      await refreshUserBalance();
      return { hash: txHash, result: response };
    }
    if (response.status === "FAILED") {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(response.resultResultXdr)}`);
    }
    await new Promise(r => setTimeout(r, 1000));
    count++;
  }
  const err = new Error("Transaction confirmation timeout after 30 seconds.");
  err.isTimeout = true;
  throw err;
}

// ============================================================
// ENGAGEMENT LOADING
// ============================================================

function loadLocalStorageConfig() {
  const saved = localStorage.getItem("vouchsafe_contract_id");
  if (saved) {
    $("contractIdInput").value = saved;
    activeContractId = saved;
  } else {
    $("contractIdInput").value = DEFAULT_CONTRACT_ID;
    activeContractId = DEFAULT_CONTRACT_ID;
  }
}

async function loadEngagements() {
  // Need at least one wallet connected to query
  const anyAddress = clientWallet.address || developerWallet.address;
  if (!anyAddress) return;

  activeContractId = $("contractIdInput").value.trim();
  if (!activeContractId) return;

  localStorage.setItem("vouchsafe_contract_id", activeContractId);

  try {
    setTxState(TxState.IDLE); // Clear any old state

    let nextId = 15n; // Scan up to 15 engagements by default
    try {
      const rawNext = await simulateReadOnly(activeContractId, "create_engagement", [
        StellarSdk.nativeToScVal(anyAddress, { type: "address" }),
        StellarSdk.nativeToScVal(anyAddress, { type: "address" }),
        StellarSdk.nativeToScVal(anyAddress, { type: "address" }),
        StellarSdk.nativeToScVal(1n, { type: "i128" }),
        StellarSdk.nativeToScVal(0n, { type: "u64" }),
      ]);
      nextId = BigInt(rawNext) - 1n;
      if (nextId < 0n) nextId = 0n;
    } catch (_) {}

    engagementsList = [];
    for (let id = 1n; id <= nextId; id++) {
      try {
        const idVal = StellarSdk.nativeToScVal(id, { type: "u64" });
        const engagement = await simulateReadOnly(activeContractId, "get_engagement", [idVal]);
        if (engagement) {
          const clientAddr = clientWallet.address;
          const devAddr    = developerWallet.address;
          // Show engagement if either wallet is a participant
          if (
            (clientAddr && (engagement.client === clientAddr || engagement.developer === clientAddr)) ||
            (devAddr    && (engagement.client === devAddr    || engagement.developer === devAddr))
          ) {
            engagementsList.push(engagement);
          }
        }
      } catch (_) {
        break;
      }
    }

    renderEngagements();
    startOnChainEventPolling();
  } catch (err) {
    console.error("Failed to load engagements:", err);
  }
}

// ============================================================
// RENDER — ENGAGEMENTS LIST + METRICS
// ============================================================

function renderEngagements() {
  updateMetrics();
  const listEl = $("engagementList");
  if (!listEl) return;
  listEl.innerHTML = "";

  const activeAddress = currentRole === "client"
    ? clientWallet.address
    : developerWallet.address;

  if (!activeAddress) {
    listEl.innerHTML = `<div class="text-center text-muted" style="padding:20px 0;">Connect your ${currentRole} wallet to view engagements.</div>`;
    return;
  }

  const filtered = engagementsList.filter(e =>
    currentRole === "client"
      ? e.client === activeAddress
      : e.developer === activeAddress
  );

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="text-center text-muted" style="padding:20px 0;">No engagements found for your ${currentRole} wallet.</div>`;
    return;
  }

  filtered.forEach(e => {
    const item = document.createElement("button");
    item.className = `engagement-item ${selectedEngagement && selectedEngagement.id === e.id ? "active" : ""}`;
    const statusName = getStatusString(e.status);
    const partner = currentRole === "client" ? truncateAddr(e.developer) : truncateAddr(e.client);

    item.innerHTML = `
      <div class="item-header">
        <span class="item-title">Engagement #${e.id}</span>
        <span class="item-amount">${stroopsToXlm(e.amount)} XLM</span>
      </div>
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;">Partner: ${partner}</div>
      <span class="badge badge-${statusName.toLowerCase()}">${statusName}</span>
    `;
    item.addEventListener("click", () => {
      selectedEngagement = e;
      renderEngagements();
      renderEngagementDetails();
    });
    listEl.appendChild(item);
  });
}

function updateMetrics() {
  const active   = engagementsList.filter(e => getStatusString(e.status) !== "Completed").length;
  const awaiting = engagementsList.filter(e => {
    const s = getStatusString(e.status);
    return currentRole === "client" ? (s === "Created" || s === "WorkSubmitted") : (s === "Funded");
  }).length;
  const completed = engagementsList.filter(e => getStatusString(e.status) === "Completed").length;
  const escrowed = engagementsList
    .filter(e => ["Funded", "WorkSubmitted", "Approved"].includes(getStatusString(e.status)))
    .reduce((sum, e) => sum + Number(stroopsToXlm(e.amount)), 0);

  if ($("statActiveEngagements")) $("statActiveEngagements").textContent = active;
  if ($("statAwaitingAction"))    $("statAwaitingAction").textContent    = awaiting;
  if ($("statCompleted"))         $("statCompleted").textContent         = completed;
  if ($("statTotalEscrowed"))     $("statTotalEscrowed").textContent     = `${escrowed.toFixed(2)} XLM`;
}

function getStatusString(status) {
  if (status && typeof status === "object") {
    return status.name || Object.keys(status)[0] || "Created";
  }
  if (typeof status === "string") return status;
  return ["Created", "Funded", "WorkSubmitted", "Approved", "Completed"][Number(status)] || "Created";
}

function getStatusIndex(status) {
  const s = getStatusString(status);
  return ["Created", "Funded", "WorkSubmitted", "Approved", "Completed"].indexOf(s);
}

// ============================================================
// RENDER — ENGAGEMENT DETAILS + CONTEXTUAL ACTIONS
// ============================================================

function renderEngagementDetails() {
  if (!selectedEngagement) {
    $("noActiveSelection").classList.remove("hidden");
    $("activeSelectionDetails").classList.add("hidden");
    return;
  }

  $("noActiveSelection").classList.add("hidden");
  $("activeSelectionDetails").classList.remove("hidden");

  const e = selectedEngagement;
  $("detailTitle").textContent = `Engagement #${e.id}`;
  $("detailId").textContent    = `#${e.id}`;
  $("detailAmount").textContent = `${stroopsToXlm(e.amount)} XLM`;
  $("detailClient").textContent    = e.client;
  $("detailDeveloper").textContent = e.developer;
  $("detailToken").textContent     = e.token;
  $("detailDeadline").textContent  = new Date(Number(e.deadline) * 1000).toLocaleString();
  $("detailDescription").textContent = "Agreement secured under Soroban escrow rules.";

  // Timeline steps
  const activeIdx = getStatusIndex(e.status);
  ["stepCreated", "stepFunded", "stepSubmitted", "stepApproved", "stepCompleted"].forEach((id, idx) => {
    const el = $(id);
    if (!el) return;
    el.classList.remove("active", "completed");
    if (idx === activeIdx) el.classList.add("active");
    else if (idx < activeIdx) el.classList.add("completed");
  });
  const pct = (activeIdx / 4) * 100;
  if ($("timelineProgress")) $("timelineProgress").style.width = `${pct}%`;

  // Proof of work block
  const statusStr = getStatusString(e.status);
  if (activeIdx >= 2) {
    $("powDetailsBox").classList.remove("hidden");
    $("detailWorkUrl").href = e.work_url;
    $("detailWorkUrl").textContent = e.work_url;
    if (e.work_pr_url) {
      $("detailPrGroup").classList.remove("hidden");
      $("detailPrUrl").href = e.work_pr_url;
      $("detailPrUrl").textContent = e.work_pr_url;
    } else {
      $("detailPrGroup").classList.add("hidden");
    }
    $("detailCommit").textContent = e.work_commit;
    $("detailNote").textContent   = e.work_note;
  } else {
    $("powDetailsBox").classList.add("hidden");
  }

  // Contextual actions — hide all first
  $("fundEscrowBtn").classList.add("hidden");
  $("approveReleaseBtn").classList.add("hidden");
  $("developerSubmitCard").classList.add("hidden");
  if ($("fundActionConfirm"))    $("fundActionConfirm").classList.add("hidden");
  if ($("approveActionConfirm")) $("approveActionConfirm").classList.add("hidden");
  $("roleNotice").textContent = "";

  if (currentRole === "client") {
    if (!clientWallet.address) {
      $("roleNotice").textContent = "Connect your Client wallet to perform actions.";
      return;
    }
    // Guard: verify this client wallet is the engagement's client
    if (e.client !== clientWallet.address) {
      $("roleNotice").textContent = `⚠️ Your client wallet (${truncateAddr(clientWallet.address)}) is not the client of this engagement.`;
      return;
    }
    if (statusStr === "Created") {
      if ($("fundActionConfirm")) $("fundActionConfirm").classList.remove("hidden");
      if ($("fundConfirmText")) $("fundConfirmText").textContent = `Lock ${stroopsToXlm(e.amount)} XLM into escrow for Engagement #${e.id}.`;
      $("fundEscrowBtn").classList.remove("hidden");
    } else if (statusStr === "WorkSubmitted") {
      if ($("approveActionConfirm")) $("approveActionConfirm").classList.remove("hidden");
      if ($("approveConfirmText")) $("approveConfirmText").textContent = `Approving releases ${stroopsToXlm(e.amount)} XLM to ${truncateAddr(e.developer)}.`;
      $("approveReleaseBtn").classList.remove("hidden");
    } else {
      $("roleNotice").textContent = `Status: ${statusStr}. Waiting for developer action.`;
    }
  } else if (currentRole === "developer") {
    if (!developerWallet.address) {
      $("roleNotice").textContent = "Connect your Developer wallet to perform actions.";
      return;
    }
    // Guard: verify developer wallet
    if (e.developer !== developerWallet.address) {
      $("roleNotice").textContent = `⚠️ Your developer wallet (${truncateAddr(developerWallet.address)}) is not the developer of this engagement.`;
      return;
    }
    if (statusStr === "Funded") {
      $("developerSubmitCard").classList.remove("hidden");
    } else {
      $("roleNotice").textContent = `Status: ${statusStr}. Waiting for client action.`;
    }
  }
}

// ============================================================
// CONTRACT ACTION HANDLERS
// ============================================================

// Create Engagement (Client role)
$("createEngagementForm").addEventListener("submit", async (evt) => {
  evt.preventDefault();
  activeContractId = $("contractIdInput").value.trim();

  const developer  = $("devAddressInput").value.trim();
  const amountXlm  = $("amountInput").value.trim();
  const token      = $("tokenInput").value.trim();
  const deadlineStr = $("deadlineInput").value;
  const deadlineUnix = BigInt(Math.floor(new Date(deadlineStr).getTime() / 1000));

  try {
    const scArgs = [
      StellarSdk.nativeToScVal(clientWallet.address, { type: "address" }),
      StellarSdk.nativeToScVal(developer, { type: "address" }),
      StellarSdk.nativeToScVal(token, { type: "address" }),
      StellarSdk.nativeToScVal(xlmToStroops(amountXlm), { type: "i128" }),
      StellarSdk.nativeToScVal(deadlineUnix, { type: "u64" }),
    ];

    const result = await invokeContractViaKit(activeContractId, "create_engagement", scArgs, "client");
    setTxState(TxState.SUCCESS, {
      message: "✅ Engagement created successfully!",
      hash: result.hash,
    });

    // Clear form
    ["devAddressInput", "titleInput", "descInput", "amountInput", "deadlineInput"].forEach(id => {
      if ($(id)) $(id).value = "";
    });

    await loadEngagements();
  } catch (err) {
    showClassifiedError(err);
  }
});

// Fund Escrow (Client role)
$("fundEscrowBtn").addEventListener("click", async () => {
  if (!selectedEngagement) return;
  try {
    const scArgs = [
      StellarSdk.nativeToScVal(BigInt(selectedEngagement.id), { type: "u64" }),
      StellarSdk.nativeToScVal(clientWallet.address, { type: "address" }),
    ];
    const result = await invokeContractViaKit(activeContractId, "fund_engagement", scArgs, "client");
    setTxState(TxState.SUCCESS, { message: "✅ Escrow funded!", hash: result.hash });
    await loadEngagements();
    selectedEngagement = engagementsList.find(e => e.id === selectedEngagement.id);
    renderEngagementDetails();
  } catch (err) {
    showClassifiedError(err);
  }
});

// Submit Work (Developer role)
$("submitWorkForm").addEventListener("submit", async (evt) => {
  evt.preventDefault();
  if (!selectedEngagement) return;

  const workUrl = $("workUrlInput").value.trim();
  const prUrl   = $("prUrlInput").value.trim();
  const commit  = $("commitInput").value.trim();
  const note    = $("noteInput").value.trim();

  try {
    const scArgs = [
      StellarSdk.nativeToScVal(BigInt(selectedEngagement.id), { type: "u64" }),
      StellarSdk.nativeToScVal(developerWallet.address, { type: "address" }),
      StellarSdk.nativeToScVal(workUrl, { type: "string" }),
      StellarSdk.nativeToScVal(prUrl,   { type: "string" }),
      StellarSdk.nativeToScVal(commit,  { type: "string" }),
      StellarSdk.nativeToScVal(note,    { type: "string" }),
    ];
    const result = await invokeContractViaKit(activeContractId, "submit_work", scArgs, "developer");
    setTxState(TxState.SUCCESS, { message: "✅ Work proof submitted!", hash: result.hash });

    ["workUrlInput", "prUrlInput", "commitInput", "noteInput"].forEach(id => {
      if ($(id)) $(id).value = "";
    });

    await loadEngagements();
    selectedEngagement = engagementsList.find(e => e.id === selectedEngagement.id);
    renderEngagementDetails();
  } catch (err) {
    showClassifiedError(err);
  }
});

// Approve Work (Client role)
$("approveReleaseBtn").addEventListener("click", async () => {
  if (!selectedEngagement) return;
  try {
    const scArgs = [
      StellarSdk.nativeToScVal(BigInt(selectedEngagement.id), { type: "u64" }),
      StellarSdk.nativeToScVal(clientWallet.address, { type: "address" }),
    ];
    const result = await invokeContractViaKit(activeContractId, "approve_work", scArgs, "client");
    setTxState(TxState.SUCCESS, { message: "✅ Work approved — payment released!", hash: result.hash });
    await loadEngagements();
    selectedEngagement = engagementsList.find(e => e.id === selectedEngagement.id);
    renderEngagementDetails();
  } catch (err) {
    showClassifiedError(err);
  }
});

// ============================================================
// ROLE SWITCHER
// ============================================================

$("clientRoleBtn").addEventListener("click", () => {
  currentRole = "client";
  $("clientRoleBtn").classList.add("active");
  $("developerRoleBtn").classList.remove("active");
  $("clientCreateCard").classList.remove("hidden");
  $("developerSubmitCard").classList.add("hidden");
  renderEngagements();
  renderEngagementDetails();
});

$("developerRoleBtn").addEventListener("click", () => {
  currentRole = "developer";
  $("developerRoleBtn").classList.add("active");
  $("clientRoleBtn").classList.remove("active");
  $("clientCreateCard").classList.add("hidden");
  renderEngagements();
  renderEngagementDetails();
});

// ============================================================
// SIDEBAR TAB SWITCHING
// ============================================================

function switchTab(tabId) {
  ["tabOverview", "tabEngagements", "tabActivity"].forEach((t, i) => {
    const tabEl = $(t);
    const btnEl = $(["navOverviewBtn", "navEngagementsBtn", "navActivityBtn"][i]);
    if (tabEl) tabEl.classList.toggle("hidden", t !== tabId);
    if (btnEl) btnEl.classList.toggle("active", t === tabId);
  });
}

if ($("navOverviewBtn"))    $("navOverviewBtn").addEventListener("click",    () => switchTab("tabOverview"));
if ($("navEngagementsBtn")) $("navEngagementsBtn").addEventListener("click", () => switchTab("tabEngagements"));
if ($("navActivityBtn"))    $("navActivityBtn").addEventListener("click",    () => switchTab("tabActivity"));
if ($("quickCreateBtn"))    $("quickCreateBtn").addEventListener("click",    () => switchTab("tabEngagements"));

$("contractIdInput").addEventListener("change", () => loadEngagements());

// ============================================================
// STEP 4 — EVENT TIMELINE (DEDUPLICATED)
// ============================================================

const EVENT_ICONS = {
  "created":   "🆕",
  "funded":    "💰",
  "submitted": "📤",
  "approved":  "✅",
  "released":  "💸",
  "completed": "🏁",
  "default":   "⛓",
};

/**
 * Add a single event entry to the timeline. Deduplicates by unique key.
 * @param {string} eventType   — the contract event name or action label
 * @param {string} txHash      — transaction hash
 * @param {number|string|null} engagementId
 * @param {"poll"|"direct-call"} source
 */
function addEventToTimeline(eventType, txHash, engagementId, source = "poll") {
  const key = `${txHash}:${eventType}:${engagementId ?? ""}`;
  if (displayedEventKeys.has(key)) return; // Skip duplicate
  displayedEventKeys.add(key);

  const feed = $("eventFeed");
  if (!feed) return;

  // Remove "no events" placeholder if present
  const placeholder = feed.querySelector(".event-placeholder");
  if (placeholder) placeholder.remove();

  const icon  = EVENT_ICONS[eventType.toLowerCase()] || EVENT_ICONS.default;
  const label = eventType.replace(/_/g, " ").toUpperCase();
  const shortHash = txHash ? `${txHash.slice(0, 8)}…${txHash.slice(-8)}` : "—";
  const explorerHref = txHash ? `https://stellar.expert/explorer/testnet/tx/${txHash}` : "#";
  const engagementLabel = engagementId ? `Engagement #${engagementId}` : "";
  const sourceLabel = source === "poll"
    ? `<span class="event-source-badge">⛓ From blockchain</span>`
    : `<span class="event-source-badge event-source-direct">📡 Direct call</span>`;
  const timeLabel = new Date().toLocaleTimeString();

  const entry = document.createElement("div");
  entry.className = "event-entry";
  entry.innerHTML = `
    <div class="event-entry-icon">${icon}</div>
    <div class="event-entry-body">
      <div class="event-entry-type">${label} ${engagementLabel ? `— <span class="monospace">${engagementLabel}</span>` : ""}</div>
      <div class="event-entry-meta">
        ${sourceLabel}
        <span class="event-entry-time">${timeLabel}</span>
      </div>
      ${txHash ? `
      <div class="event-entry-hash monospace">${shortHash}
        <a href="${explorerHref}" target="_blank" class="explorer-link" style="margin-left:8px;">StellarExpert ↗</a>
      </div>` : ""}
    </div>
  `;

  feed.prepend(entry); // Latest first

  // Cap at 50 entries
  while (feed.children.length > 50) {
    feed.removeChild(feed.lastChild);
  }

  // Also write to legacy txLogBody table if it exists (backward compat)
  const tbody = $("txLogBody");
  if (tbody) {
    if (tbody.textContent.includes("No transactions recorded")) tbody.innerHTML = "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${label}</strong></td>
      <td>${engagementLabel}</td>
      <td class="monospace">${shortHash}</td>
      <td>${txHash ? `<a href="${explorerHref}" target="_blank" class="explorer-link">StellarExpert ↗</a>` : "—"}</td>
    `;
    tbody.prepend(tr);
  }
}

// ============================================================
// LIVE EVENT POLLING (deduplicated)
// ============================================================

function startOnChainEventPolling() {
  if (eventInterval) clearInterval(eventInterval);

  // Update sync indicator
  const syncDot = $("syncIndicator");
  if (syncDot) syncDot.classList.add("sync-active");

  eventInterval = setInterval(async () => {
    if (!activeContractId) return;
    try {
      const { sequence: latestLedger } = await rpcServer.getLatestLedger();

      if (lastCheckedLedger === 0) {
        lastCheckedLedger = latestLedger - 10;
      }
      if (lastCheckedLedger >= latestLedger) return;

      const response = await rpcServer.getEvents({
        startLedger: lastCheckedLedger + 1,
        filters: [{ type: "contract", contractIds: [activeContractId] }],
        limit: 20,
      });

      lastCheckedLedger = latestLedger;

      if (response.events && response.events.length > 0) {
        let hasNew = false;
        response.events.forEach(evt => {
          try {
            const topics = evt.topic.map(t => StellarSdk.scValToNative(t));
            const eventType   = topics[0]; // e.g. "created", "funded"
            const engagementId = topics[1]; // u64
            const key = `${evt.txHash}:${eventType}:${engagementId}`;

            if (!displayedEventKeys.has(key)) {
              addEventToTimeline(eventType, evt.txHash, engagementId, "poll");
              hasNew = true;
            }
          } catch (_) {}
        });

        if (hasNew) {
          await loadEngagements();
          if (selectedEngagement) {
            selectedEngagement = engagementsList.find(e => e.id === selectedEngagement.id);
            renderEngagementDetails();
          }
        }
      }
    } catch (err) {
      console.error("[Event polling]", err);
    }
  }, 6000);
}

// ============================================================
// SEND XLM — White Belt requirement (preserved)
// ============================================================

async function sendXlm(destination, amountXlm, memo) {
  const activeSlot = getWalletSlot(currentRole);
  if (!activeSlot.address) {
    const resultDiv = $("xlmTxResult");
    const statusDiv = $("xlmTxStatus");
    if (resultDiv) resultDiv.classList.remove("hidden");
    if (statusDiv) { statusDiv.style.color = "var(--danger)"; statusDiv.textContent = "❌ Connect your wallet first."; }
    return;
  }

  const signerAddress = activeSlot.address;
  const resultDiv = $("xlmTxResult");
  const statusDiv = $("xlmTxStatus");
  const hashRow   = $("xlmTxHashRow");
  const linkEl    = $("xlmTxLink");

  if (resultDiv) resultDiv.classList.remove("hidden");
  if (statusDiv) { statusDiv.style.color = "var(--text-secondary)"; statusDiv.textContent = "⏳ Preparing transaction…"; }
  if (hashRow) hashRow.classList.add("hidden");
  if (linkEl)  linkEl.classList.add("hidden");

  try {
    // Switch kit to active role's wallet
    kit.setWallet(activeSlot.providerId);

    setTxState(TxState.AWAITING_WALLET, { message: "Waiting for wallet to sign XLM payment…" });
    const sourceAccount = await horizonServer.loadAccount(signerAddress);

    const txBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(StellarSdk.Operation.payment({
        destination,
        asset: StellarSdk.Asset.native(),
        amount: String(Number(amountXlm).toFixed(7)),
      }))
      .setTimeout(30);

    if (memo && memo.trim().length > 0) {
      txBuilder.addMemo(StellarSdk.Memo.text(memo.trim()));
    }
    const tx = txBuilder.build();

    if (statusDiv) statusDiv.textContent = "✍️ Waiting for wallet signature…";

    const { signedTxXdr } = await kit.signTransaction(tx.toXDR(), {
      address: signerAddress,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
    setTxState(TxState.SUBMITTING);
    if (statusDiv) statusDiv.textContent = "📡 Submitting to Stellar Testnet…";

    const response = await horizonServer.submitTransaction(signedTx);
    const txHash = response.hash;

    if (statusDiv) { statusDiv.style.color = "var(--success)"; statusDiv.textContent = `✅ XLM Sent — ${amountXlm} XLM to ${destination.slice(0,6)}…${destination.slice(-6)}`; }
    if (hashRow) { hashRow.classList.remove("hidden"); hashRow.textContent = `Tx Hash: ${txHash}`; }
    if (linkEl)  { linkEl.href = `https://stellar.expert/explorer/testnet/tx/${txHash}`; linkEl.classList.remove("hidden"); linkEl.style.display = "inline-block"; }

    addEventToTimeline("XLM Payment", txHash, null, "direct-call");
    setTxState(TxState.SUCCESS, { hash: txHash, message: "XLM Payment successful!" });
    await refreshUserBalance();
    $("sendXlmForm").reset();
  } catch (err) {
    const classified = classifyError(err);
    if (statusDiv) { statusDiv.style.color = "var(--danger)"; statusDiv.textContent = `❌ ${classified.title}: ${classified.message}`; }
    showClassifiedError(err);
  }
}

const sendXlmForm = $("sendXlmForm");
if (sendXlmForm) {
  sendXlmForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const dest   = $("xlmDestInput").value.trim();
    const amount = $("xlmAmountInput").value;
    const memo   = $("xlmMemoInput").value;

    if (!dest.startsWith("G") || dest.length !== 56) {
      alert("Please enter a valid Stellar address (starts with G, 56 chars).");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      alert("Please enter a positive XLM amount.");
      return;
    }
    await sendXlm(dest, amount, memo);
  });
}

// ============================================================
// WIRE WALLET BUTTONS
// ============================================================

if ($("connectClientBtn"))      $("connectClientBtn").addEventListener("click",      () => connectWalletForRole("client"));
if ($("connectDeveloperBtn"))   $("connectDeveloperBtn").addEventListener("click",   () => connectWalletForRole("developer"));
if ($("disconnectClientBtn"))   $("disconnectClientBtn").addEventListener("click",   () => disconnectWalletForRole("client"));
if ($("disconnectDeveloperBtn")) $("disconnectDeveloperBtn").addEventListener("click", () => disconnectWalletForRole("developer"));

// Legacy buttons (backward compat — hidden by new UI but kept in case)
if ($("connectWalletBtn"))     $("connectWalletBtn").addEventListener("click",     () => connectWalletForRole(currentRole));
if ($("disconnectWalletBtn"))  $("disconnectWalletBtn").addEventListener("click",  () => disconnectWalletForRole(currentRole));

// ============================================================
// INIT
// ============================================================
loadLocalStorageConfig();
updateWalletUI();
