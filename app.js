import StellarSdk from "https://esm.sh/@stellar/stellar-sdk@14.0.0";
import { StellarWalletsKit, WalletNetwork, allowAllModules } from "https://esm.sh/@creit.tech/stellar-wallets-kit@1.7.5?bundle&deps=@stellar/stellar-sdk@14.0.0";

import { classifyError } from "./src/utils/errors.js";
import { stroopsToXlm, xlmToStroops, truncateAddr, getStatusString } from "./src/utils/formatting.js";
import { clientWallet, developerWallet, setWalletSlot, requireSigningWallet } from "./src/wallet/roles.js";
import { isEventDisplayed, markEventDisplayed } from "./src/contract/events.js";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

const rpcNamespace = StellarSdk.SorobanRpc || StellarSdk.rpc;
const horizonServer = new StellarSdk.Horizon.Server(HORIZON_URL);
const rpcServer = new rpcNamespace.Server(RPC_URL);

// State management
let connectedAddress = null;
let activeContractId = null;
let engagementsList = [];
let selectedEngagement = null;
let currentRole = "client"; // "client" or "developer"
let lastCheckedLedger = 0;
let eventInterval = null;

// Default Deployed Vouchsafe Contract ID (Users can override in UI)
const DEFAULT_CONTRACT_ID = "CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR"; 

// Initialize Wallets Kit
const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: allowAllModules(),
});

const $ = (id) => document.getElementById(id);

// UI Helpers
function showStatus(text, type = "loading", link = null) {
  const banner = $("statusBanner");
  const icon = $("statusIcon");
  const textEl = $("statusText");
  
  banner.classList.remove("hidden", "success", "error");
  icon.className = "spinner";
  
  if (type === "success") {
    banner.classList.add("success");
    icon.className = "";
    icon.innerHTML = "✅";
  } else if (type === "error") {
    banner.classList.add("error");
    icon.className = "";
    icon.innerHTML = "❌";
  } else {
    icon.innerHTML = "";
  }
  
  let content = text;
  if (link) {
    content += ` <a href="${link}" target="_blank" class="explorer-link" style="margin-left: 8px;">View Tx ↗</a>`;
  }
  textEl.innerHTML = content;
}

function hideStatus() {
  $("statusBanner").classList.add("hidden");
}

// Connect Wallet using Role Slots & Error Engine
async function connectWallet() {
  try {
    showStatus("Opening wallet options...");
    await kit.openModal({
      onWalletSelected: async (option) => {
        try {
          showStatus("Connecting wallet...");
          kit.setWallet(option.id);
          const { address } = await kit.getAddress();
          connectedAddress = address;
          setWalletSlot("client", address, option.id);
          setWalletSlot("developer", address, option.id);
          
          $("walletAddress").textContent = truncateAddr(address);
          $("walletAddress").classList.remove("hidden");
          $("networkBadge").classList.remove("hidden");
          $("connectWalletBtn").classList.add("hidden");
          
          hideStatus();
          loadLocalStorageConfig();
          await loadEngagements();
        } catch (err) {
          const classified = classifyError(err);
          showStatus(`${classified.title}: ${classified.message}`, "error");
        }
      },
    });
    hideStatus();
  } catch (err) {
    const classified = classifyError(err);
    showStatus(`${classified.title}: ${classified.message}`, "error");
  }
}

// Load configurations
function loadLocalStorageConfig() {
  const savedContract = localStorage.getItem("vouchsafe_contract_id");
  if (savedContract) {
    $("contractIdInput").value = savedContract;
    activeContractId = savedContract;
  } else {
    $("contractIdInput").value = DEFAULT_CONTRACT_ID;
    activeContractId = DEFAULT_CONTRACT_ID;
  }
}

// Generic Read Simulation
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
  } else {
    throw new Error(`Simulation of ${method} failed: ${response.error || "unknown error"}`);
  }
}

// Generic Invoke Write Method with Role Signing Guard
async function invokeContractViaKit(contractId, method, scArgs = []) {
  const signingAddress = requireSigningWallet(currentRole, kit);
  
  showStatus(`Preparing ${method}...`);
  const sourceAccount = await horizonServer.loadAccount(signingAddress);
  
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

  showStatus("Simulating transaction footprint...");
  tx = await rpcServer.prepareTransaction(tx);

  showStatus("Waiting for wallet signature...");
  const { signedTxXdr } = await kit.signTransaction(tx.toXDR(), {
    address: signingAddress,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  
  const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);

  showStatus("Submitting transaction to Testnet...");
  let response = await rpcServer.sendTransaction(signedTx);
  if (response.status === "ERROR") {
    throw new Error(`RPC submit error: ${JSON.stringify(response.errorResult)}`);
  }

  const txHash = response.hash;
  showStatus("Confirming transaction on-chain...", "loading", `https://stellar.expert/explorer/testnet/tx/${txHash}`);
  
  let count = 0;
  while (count < 25) {
    response = await rpcServer.getTransaction(txHash);
    if (response.status === "SUCCESS") {
      logOnChainTx(method, txHash);
      return { hash: txHash, result: response };
    }
    if (response.status === "FAILED") {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(response.resultResultXdr)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
    count++;
  }
  throw new Error("Transaction confirmation timeout. Verify state later.");
}

// Log transactions locally in UI
function logOnChainTx(actionName, hash) {
  const tbody = $("txLogBody");
  if (tbody.textContent.includes("No transactions recorded")) {
    tbody.innerHTML = "";
  }
  
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><strong>${actionName}</strong></td>
    <td>#${selectedEngagement ? selectedEngagement.id : "-"}</td>
    <td class="monospace">${hash.slice(0, 8)}...${hash.slice(-8)}</td>
    <td><a href="https://stellar.expert/explorer/testnet/tx/${hash}" target="_blank" class="explorer-link">StellarExpert ↗</a></td>
  `;
  tbody.prepend(tr);
}

// Load all engagements using clean, deterministic sequential query loop
async function loadEngagements() {
  if (!connectedAddress) return;
  activeContractId = $("contractIdInput").value.trim();
  if (!activeContractId || activeContractId.startsWith("CAAAAA_")) {
    $("engagementList").innerHTML = `<div class="text-center text-muted" style="padding: 20px 0;">Please enter a valid deployed Contract ID.</div>`;
    return;
  }

  localStorage.setItem("vouchsafe_contract_id", activeContractId);

  try {
    showStatus("Fetching engagements...");
    engagementsList = [];

    let id = 1n;
    while (true) {
      try {
        const idVal = StellarSdk.nativeToScVal(id, { type: "u64" });
        const engagement = await simulateReadOnly(activeContractId, "get_engagement", [idVal]);
        if (!engagement) break;
        
        if (engagement.client === connectedAddress || engagement.developer === connectedAddress) {
          engagementsList.push(engagement);
        }
        id++;
      } catch (err) {
        // Stop querying when an engagement key does not exist or call fails
        break;
      }
    }

    hideStatus();
    renderEngagements();
    startOnChainEventPolling();
  } catch (err) {
    const classified = classifyError(err);
    showStatus(`${classified.title}: ${classified.message}`, "error");
  }
}

// Render Engagements List
function renderEngagements() {
  const listEl = $("engagementList");
  listEl.innerHTML = "";

  const filtered = engagementsList.filter(e => {
    if (currentRole === "client") {
      return e.client === connectedAddress;
    } else {
      return e.developer === connectedAddress;
    }
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="text-center text-muted" style="padding: 20px 0;">No active engagements found for you.</div>`;
    return;
  }

  filtered.forEach(e => {
    const item = document.createElement("button");
    item.className = `engagement-item ${selectedEngagement && selectedEngagement.id === e.id ? 'active' : ''}`;
    
    const statusName = getStatusString(e.status);
    
    item.innerHTML = `
      <div class="item-header">
        <span class="item-title">${e.work_url ? 'Proof Submitted' : 'Agreement'} #${e.id}</span>
        <span class="item-amount">${stroopsToXlm(e.amount)} XLM</span>
      </div>
      <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">
        Partner: ${currentRole === "client" ? truncateAddr(e.developer) : truncateAddr(e.client)}
      </div>
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

function getStatusIndex(status) {
  const statusStr = getStatusString(status);
  const mapping = ["Created", "Funded", "WorkSubmitted", "Approved", "Completed", "Cancelled", "Expired"];
  return mapping.indexOf(statusStr);
}

// Render selected engagement details
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
  $("detailId").textContent = `#${e.id}`;
  $("detailAmount").textContent = `${stroopsToXlm(e.amount)} XLM`;
  $("detailClient").textContent = e.client;
  $("detailDeveloper").textContent = e.developer;
  $("detailToken").textContent = e.token;
  
  const deadlineDate = new Date(Number(e.deadline) * 1000);
  $("detailDeadline").textContent = deadlineDate.toLocaleString();

  // Set default details
  $("detailDescription").textContent = "Agreement funded and secured under Soroban escrow rules.";

  // Update Timeline Steps
  const activeIdx = getStatusIndex(e.status);
  const steps = ["stepCreated", "stepFunded", "stepSubmitted", "stepApproved", "stepCompleted"];
  
  steps.forEach((stepId, idx) => {
    const el = $(stepId);
    el.classList.remove("active", "completed");
    if (idx === activeIdx) {
      el.classList.add("active");
    } else if (idx < activeIdx) {
      el.classList.add("completed");
    }
  });

  const progressPercent = Math.min((activeIdx / (steps.length - 1)) * 100, 100);
  $("timelineProgress").style.width = `${progressPercent}%`;

  // Render proof of work block if submitted
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
    $("detailNote").textContent = e.work_note;
  } else {
    $("powDetailsBox").classList.add("hidden");
  }

  // Update action buttons contextually
  $("fundEscrowBtn").classList.add("hidden");
  $("approveReleaseBtn").classList.add("hidden");
  $("developerSubmitCard").classList.add("hidden");
  $("roleNotice").textContent = "";

  if (currentRole === "client") {
    if (statusStr === "Created") {
      $("fundEscrowBtn").classList.remove("hidden");
    } else if (statusStr === "WorkSubmitted") {
      $("approveReleaseBtn").classList.remove("hidden");
    } else {
      $("roleNotice").textContent = `Status: ${statusStr}. Waiting for developer deliverables.`;
    }
  } else if (currentRole === "developer") {
    if (statusStr === "Funded") {
      $("developerSubmitCard").classList.remove("hidden");
    } else {
      $("roleNotice").textContent = `Status: ${statusStr}. Waiting for client action.`;
    }
  }
}

// Create Engagement Submit Action
$("createEngagementForm").addEventListener("submit", async (evt) => {
  evt.preventDefault();
  
  if (!connectedAddress) {
    showStatus("Please click 'Connect Wallet' in the top bar first.", "error");
    return;
  }

  activeContractId = $("contractIdInput").value.trim();
  
  if (!activeContractId || activeContractId.startsWith("CAAAAA_")) {
    showStatus("Please set a valid contract address in configuration first.", "error");
    return;
  }

  const developer = $("devAddressInput").value.trim();
  const title = $("titleInput").value.trim();
  const desc = $("descInput").value.trim();
  const amountXlm = $("amountInput").value.trim();
  const token = $("tokenInput").value.trim();
  const deadlineStr = $("deadlineInput").value;
  const deadlineUnix = BigInt(Math.floor(new Date(deadlineStr).getTime() / 1000));

  try {
    const scArgs = [
      StellarSdk.nativeToScVal(connectedAddress, { type: "address" }),
      StellarSdk.nativeToScVal(developer, { type: "address" }),
      StellarSdk.nativeToScVal(token, { type: "address" }),
      StellarSdk.nativeToScVal(xlmToStroops(amountXlm), { type: "i128" }),
      StellarSdk.nativeToScVal(deadlineUnix, { type: "u64" })
    ];

    const result = await invokeContractViaKit(activeContractId, "create_engagement", scArgs);
    showStatus("✅ Engagement created successfully!", "success", `https://stellar.expert/explorer/testnet/tx/${result.hash}`);
    
    // Clear form
    $("devAddressInput").value = "";
    $("titleInput").value = "";
    $("descInput").value = "";
    $("amountInput").value = "";
    $("tokenInput").value = "";
    $("deadlineInput").value = "";

    await loadEngagements();
  } catch (err) {
    const classified = classifyError(err);
    showStatus(`${classified.title}: ${classified.message}`, "error");
  }
});

// Client Action: Fund Escrow
$("fundEscrowBtn").addEventListener("click", async () => {
  if (!selectedEngagement) return;
  try {
    const scArgs = [
      StellarSdk.nativeToScVal(BigInt(selectedEngagement.id), { type: "u64" }),
      StellarSdk.nativeToScVal(connectedAddress, { type: "address" })
    ];

    const result = await invokeContractViaKit(activeContractId, "fund_engagement", scArgs);
    showStatus("✅ Escrow funded and active!", "success", `https://stellar.expert/explorer/testnet/tx/${result.hash}`);
    
    await loadEngagements();
    selectedEngagement = engagementsList.find(e => e.id === selectedEngagement.id);
    renderEngagementDetails();
  } catch (err) {
    const classified = classifyError(err);
    showStatus(`${classified.title}: ${classified.message}`, "error");
  }
});

// Developer Action: Submit Proof of Work
$("submitWorkForm").addEventListener("submit", async (evt) => {
  evt.preventDefault();
  if (!selectedEngagement) return;

  const workUrl = $("workUrlInput").value.trim();
  const prUrl = $("prUrlInput").value.trim();
  const commit = $("commitInput").value.trim();
  const note = $("noteInput").value.trim();

  try {
    const scArgs = [
      StellarSdk.nativeToScVal(BigInt(selectedEngagement.id), { type: "u64" }),
      StellarSdk.nativeToScVal(connectedAddress, { type: "address" }),
      StellarSdk.nativeToScVal(workUrl, { type: "string" }),
      StellarSdk.nativeToScVal(prUrl, { type: "string" }),
      StellarSdk.nativeToScVal(commit, { type: "string" }),
      StellarSdk.nativeToScVal(note, { type: "string" })
    ];

    const result = await invokeContractViaKit(activeContractId, "submit_work", scArgs);
    showStatus("✅ Proof of work submitted successfully!", "success", `https://stellar.expert/explorer/testnet/tx/${result.hash}`);
    
    $("workUrlInput").value = "";
    $("prUrlInput").value = "";
    $("commitInput").value = "";
    $("noteInput").value = "";

    await loadEngagements();
    selectedEngagement = engagementsList.find(e => e.id === selectedEngagement.id);
    renderEngagementDetails();
  } catch (err) {
    const classified = classifyError(err);
    showStatus(`${classified.title}: ${classified.message}`, "error");
  }
});

// Client Action: Approve and Release
$("approveReleaseBtn").addEventListener("click", async () => {
  if (!selectedEngagement) return;
  try {
    const scArgs = [
      StellarSdk.nativeToScVal(BigInt(selectedEngagement.id), { type: "u64" }),
      StellarSdk.nativeToScVal(connectedAddress, { type: "address" })
    ];

    const result = await invokeContractViaKit(activeContractId, "approve_work", scArgs);
    showStatus("✅ Escrow approved and payment released!", "success", `https://stellar.expert/explorer/testnet/tx/${result.hash}`);
    
    await loadEngagements();
    selectedEngagement = engagementsList.find(e => e.id === selectedEngagement.id);
    renderEngagementDetails();
  } catch (err) {
    const classified = classifyError(err);
    showStatus(`${classified.title}: ${classified.message}`, "error");
  }
});

// Role selection switching
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
  if (selectedEngagement && getStatusString(selectedEngagement.status) === "Funded") {
    $("developerSubmitCard").classList.remove("hidden");
  }
  renderEngagements();
  renderEngagementDetails();
});

// Setup input change event to reload list
$("contractIdInput").addEventListener("change", () => {
  loadEngagements();
});

// Live Event Polling with Deduplication Engine
function startOnChainEventPolling() {
  if (eventInterval) clearInterval(eventInterval);
  
  eventInterval = setInterval(async () => {
    if (!activeContractId || activeContractId.startsWith("CAAAAA_")) return;
    try {
      const latestLedgerResponse = await rpcServer.getLatestLedger();
      const latestLedger = latestLedgerResponse.sequence;
      
      if (lastCheckedLedger === 0) {
        lastCheckedLedger = latestLedger - 10; 
      }

      if (lastCheckedLedger >= latestLedger) return;

      const response = await rpcServer.getEvents({
        startLedger: lastCheckedLedger + 1,
        filters: [{ type: "contract", contractIds: [activeContractId] }],
        limit: 10
      });

      lastCheckedLedger = latestLedger;

      if (response.events && response.events.length > 0) {
        response.events.forEach((evt) => {
          const topics = evt.topic.map((t) => StellarSdk.scValToNative(t));
          const type = topics[0];
          const id = topics[1];

          if (!isEventDisplayed(evt.txHash, type, id)) {
            markEventDisplayed(evt.txHash, type, id);
            logOnChainTx(`${String(type).toUpperCase()} Event`, evt.txHash);
          }
        });
        
        await loadEngagements();
        if (selectedEngagement) {
          selectedEngagement = engagementsList.find(e => e.id === selectedEngagement.id);
          renderEngagementDetails();
        }
      }
    } catch (err) {
      console.error("On-chain event polling error:", err);
    }
  }, 6000);
}

// Wire Connect Button
$("connectWalletBtn").addEventListener("click", connectWallet);
