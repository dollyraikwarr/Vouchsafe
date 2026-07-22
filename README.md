# Vouchsafe — On-Chain Escrow Payment Protocol on Stellar

> A Soroban-powered escrow protocol that pays developers only after verifiable proof of work is submitted and client-approved.

---

## 🏆 Level Compliance

| Belt | Status |
|------|--------|
| ⚪️ White Belt (Level 1) | ✅ Complete |
| 🟡 Yellow Belt (Level 2) | ✅ Complete |

---

## 1. Project Overview

Vouchsafe eliminates trust-based payment risk in freelance technical work. Clients lock payment into a Soroban smart contract escrow. Developers submit verifiable proof of work (URL, PR, commit hash). Clients inspect the proof and approve — releasing payment atomically in the same transaction.

---

## 2. Problem Being Solved

| Role | Problem Without Vouchsafe |
|------|--------------------------|
| Developer | Delivers first, invoices after. No leverage if client stalls |
| Client | Pays upfront and hopes, or routes through a platform that takes a cut |

---

## 3. Architecture Overview

```
Browser (index.html + app.js)
    │
    ├── StellarWalletsKit (Freighter, Albedo, xBull, LOBSTR, Hana)
    │       ├── Client Wallet Slot  (signs create/fund/approve)
    │       └── Developer Wallet Slot (signs submit_work)
    │
    ├── Soroban RPC: soroban-testnet.stellar.org
    │       ├── prepareTransaction → simulate → submit → confirm
    │       └── getEvents() polling every 6s (deduplicated)
    │
    └── Horizon: horizon-testnet.stellar.org
            ├── loadAccount (sequence numbers)
            └── submitTransaction (XLM native payments)
```

---

## 4. White Belt Functionality (Level 1)

- ✅ Freighter + multi-wallet via StellarWalletsKit `allowAllModules()`
- ✅ Wallet connect / disconnect — modal selection for each role
- ✅ XLM balance display — fetched from Horizon after connection
- ✅ Send XLM on Testnet — native Operation.payment with hash + StellarExpert link
- ✅ Transaction feedback — inline status with tx hash

---

## 5. Yellow Belt Upgrades (Level 2)

### 5.1 Multi-Wallet Architecture
Two independent wallet slots with signing guards:
- **Client Wallet**: signs `create_engagement`, `fund_engagement`, `approve_work`
- **Developer Wallet**: signs `submit_work`

`requireSigningWallet(role)` verifies the correct wallet BEFORE any UI change.

### 5.2 Transaction State Machine
Every contract call progresses through 5 explicit states:
`IDLE → AWAITING_WALLET_APPROVAL → SUBMITTING → PENDING_CONFIRMATION → SUCCESS/FAILED`

### 5.3 Classified Error Handling
`classifyError()` inspects in priority order:
1. Horizon result codes (`op_underfunded`, `tx_bad_auth`)
2. RPC simulation errors
3. Wallet-specific error codes (`err.code`)
4. Error message text (fallback)

### 5.4 Deduplicated Event Timeline
Events deduplicated by key: `txHash:eventType:engagementId`
Live sync indicator pulses green while polling is active.

---

## 6. Supported Wallet Options

| Wallet | Type | Extension Required |
|--------|------|-------------------|
| Freighter | Browser extension | Yes |
| Albedo | Web-based | No |
| xBull | Browser extension | Yes |
| LOBSTR | Mobile | No |
| Hana | Browser extension | Yes |

Tip: Use Albedo for one role (no install needed) and Freighter for the other.

![StellarWalletsKit Provider Selection Modal](wallet_options_modal.png)

---

## 7. Stellar Testnet Configuration

| Setting | Value |
|---------|-------|
| Network | Stellar Testnet |
| RPC URL | `https://soroban-testnet.stellar.org` |
| Horizon URL | `https://horizon-testnet.stellar.org` |
| Network Passphrase | `Test SDF Network ; September 2015` |
| Friendbot | `https://friendbot.stellar.org/?addr=ADDRESS` |

---

## 8. Deployed Contract

| Item | Value |
|------|-------|
| **Contract ID** | `CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR` |
| **Network** | Stellar Testnet |
| **Deployer** | `GBCQI56TO2T27F3I4XRZK72NSUFRJAM4M7ZIBCNA35O4W5F7WIJU4VKO` |
| **Native XLM SAC** | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| **Explorer Link** | [View Contract on StellarExpert ↗](https://stellar.expert/explorer/testnet/contract/CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR) |

---

## 9. Contract Functions

| Function | Authorized By | Action |
|----------|---------------|--------|
| `create_engagement(client, developer, token, amount, deadline)` | Client | Registers engagement, returns ID |
| `fund_engagement(id, client)` | Client | Transfers token to escrow |
| `submit_work(id, developer, work_url, work_pr_url, work_commit, work_note)` | Developer | Records proof on-chain |
| `approve_work(id, client)` | Client | Releases escrow; sets Completed |
| `get_engagement(id)` | Anyone (read-only) | Returns engagement struct |

---

## 10. State Machine

`CREATED → (fund_engagement) → FUNDED → (submit_work) → WORK_SUBMITTED → (approve_work) → APPROVED → COMPLETED`

Each transition is irreversible and authorized.

---

## 11. Event Architecture

Events are polled via `rpcServer.getEvents()` every 6 seconds.
Deduplication key: `txHash:eventType:engagementId`

| Event | Triggered By | Payload |
|-------|-------------|---------|
| `created` | `create_engagement` | `(client, developer, amount)` |
| `funded` | `fund_engagement` | `client` |
| `submitted` | `submit_work` | `developer` |
| `approved` | `approve_work` | `client` |
| `released` | `approve_work` | `(developer, amount)` |
| `completed` | `approve_work` | `()` |

---

## 12. Transaction Lifecycle

1. `requireSigningWallet(role)`     -- guard: correct wallet connected?
2. `setTxState(AWAITING_WALLET)`    -- "Waiting for wallet approval"
3. `kit.setWallet(providerId)`      -- switch to role provider
4. `horizonServer.loadAccount()`    -- get sequence number
5. `TransactionBuilder → build()`  -- construct operation
6. `rpcServer.prepareTransaction()` -- simulate + auth entries
7. `kit.signTransaction()`          -- wallet signs XDR
8. `setTxState(SUBMITTING)`         -- "Submitting to Stellar Testnet"
9. `rpcServer.sendTransaction()`    -- broadcast
10. `setTxState(PENDING_CONFIRMATION)` -- "Waiting for confirmation"
11. `rpcServer.getTransaction(hash)` -- poll until SUCCESS or FAILED
12. `setTxState(SUCCESS | FAILED)`   -- show hash / error + hint

---

## 13. Error Handling

### Error Type 1 -- Wallet Not Available
Trigger: Selected wallet not installed or inaccessible
Detection: `err.code === "NO_WALLET"`, errMsg includes `"not installed"`
Message: "Wallet Not Available: The selected wallet is not installed."
Recovery: "Install the extension, or choose Albedo (no extension needed)."

### Error Type 2 -- User Rejected Transaction
Trigger: User dismisses the wallet signing popup
Detection: `err.code === 4001` or `-1`, errMsg includes `"user rejected"`, `"cancelled"`
Message: "Transaction Cancelled: You rejected the transaction in your wallet."
Recovery: "Click the action button again to retry."

### Error Type 3 -- Insufficient Balance
Trigger: Not enough XLM or tokens; Horizon/RPC rejects
Detection: Horizon result codes `op_underfunded`, `tx_insufficient_balance`, `op_no_trust`
Message: "Insufficient Balance: Your wallet does not have enough funds."
Recovery: "Fund your wallet at https://laboratory.stellar.org or use Friendbot."

### Additional Types: Wrong Role, Invalid State, Wrong Network, RPC Failure, Tx Timeout

---

## 14. Local Setup

```bash
cd "New project/Vouchsafe"
npx serve .
# or
python -m http.server 8000
```
Open http://localhost:8000

---

## 15. Environment Variables

No environment variables needed. All config is hardcoded for Testnet in `app.js`.

---

## 16. How to Run the Frontend

1. Start a local HTTP server in the `Vouchsafe/` directory
2. Open http://localhost:8000
3. Click Launch App or scroll to the dashboard section

---

## 17. How to Run Tests

```bash
cargo test
```
Note: Requires `x86_64-pc-windows-gnu` with `libgcc_eh`. Contract logic compiles and all 7 unit tests pass when target is native/linux. The contract WASM build (`wasm32-unknown-unknown`) compiles and deploys successfully.

---

## 18. How to Connect a Wallet

1. In the app header, find the Client or Developer wallet slot
2. Click Connect in the appropriate slot
3. The StellarWalletsKit modal opens with all available wallet providers
4. Select your wallet (Albedo works immediately, no extension needed)
5. Approve the connection in the wallet popup
6. Address and XLM balance appear in the slot
7. Repeat for the other role with a different wallet or account

---

## 19. Client Flow

1. Connect wallet in Client slot
2. Switch to Client role in sidebar
3. In Engagements tab, fill Create Agreement form
4. Token address: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` (native XLM SAC)
5. Click Create -> sign -> SUCCESS
6. Select the new engagement
7. Click Fund Escrow -> sign -> SUCCESS
8. After developer submits, click Approve Work -> sign -> SUCCESS
9. Payment releases to developer in the same transaction

---

## 20. Developer Flow

1. Connect wallet in Developer slot
2. Switch to Developer role in sidebar
3. Select the funded engagement assigned to your developer address
4. Fill the Submit Deliverables form (URL, PR URL, commit, note)
5. Click Submit Work Proof -> sign in developer wallet -> SUCCESS

---

## 21. Verifiable Testnet Transaction Hashes (Live On-Chain Evidence)

The Vouchsafe Soroban contract is deployed on Testnet and verified with live state transitions:

- **Contract ID**: `CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR`
- **1. Create Engagement Tx Hash**: [`c088da058f67426bb675f0167df48dc34199f070aff3b24e18073f88a19c3ef3`](https://stellar.expert/explorer/testnet/tx/c088da058f67426bb675f0167df48dc34199f070aff3b24e18073f88a19c3ef3)
- **2. Fund Escrow Tx Hash**: [`abfdbb455790385de32675fe8ecb7fa99f10d52fbfbc8f3f64ab58d82580541e`](https://stellar.expert/explorer/testnet/tx/abfdbb455790385de32675fe8ecb7fa99f10d52fbfbc8f3f64ab58d82580541e)
- **3. Submit Work Proof Tx Hash**: [`4d3acf2d031b80862a5b2f04d786a005cd0cb79b8b6102ff7c899ca1fe7cb14c`](https://stellar.expert/explorer/testnet/tx/4d3acf2d031b80862a5b2f04d786a005cd0cb79b8b6102ff7c899ca1fe7cb14c)
- **4. Approve & Release Escrow Tx Hash**: [`024c19ec4da8dba99d1b247e2e1c61a8cd1b0fab5bfaaf28f2b12ababc76bf93`](https://stellar.expert/explorer/testnet/tx/024c19ec4da8dba99d1b247e2e1c61a8cd1b0fab5bfaaf28f2b12ababc76bf93)

---

## 22. Stellar Explorer Links

- **Contract**: [https://stellar.expert/explorer/testnet/contract/CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR](https://stellar.expert/explorer/testnet/contract/CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR)
- **Deployer**: [https://stellar.expert/explorer/testnet/account/GBCQI56TO2T27F3I4XRZK72NSUFRJAM4M7ZIBCNA35O4W5F7WIJU4VKO](https://stellar.expert/explorer/testnet/account/GBCQI56TO2T27F3I4XRZK72NSUFRJAM4M7ZIBCNA35O4W5F7WIJU4VKO)

---

## 23. Screenshots

![StellarWalletsKit Provider Selection Modal](wallet_options_modal.png)
![Dashboard Overview & App Preview](dashboard_preview.png)

---

## 24. Known Limitations

| Limitation | Detail |
|------------|--------|
| No dispute resolution | Funds are permanently locked if neither party acts |
| No automatic timeout/refund | Deadline stored but not enforced by contract |
| Testnet only | Mainnet deployment requires security audit |
| Event pagination | getEvents() fetches last 20 events per poll cycle |
| SWK one-at-a-time | Wallet modal must close before another role can connect |
| Windows linker | cargo test fails on windows-gnu toolchain (not wasm build) |

---

## Deployment Instructions

```bash
stellar keys generate vouchsafe-deployer --network testnet --fund
cargo build --target wasm32-unknown-unknown --release
stellar contract deploy --network testnet --source vouchsafe-deployer --wasm target/wasm32-unknown-unknown/release/vouchsafe.wasm
```
