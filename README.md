# Vouchsafe — Trust & Escrow Payment Protocol on Stellar

Vouchsafe is a trust and escrow payment protocol for technical deliverables. It allows clients to create work agreements, fund them in escrow using a Stellar Asset (e.g. USDC or native XLM), and automatically release payments to developers upon submission and approval of proof of work. 

---

## 🏅 Stellar White Belt (Level 1) Compliance
This project satisfies all Level 1 White Belt submission requirements:
1. **Wallet Setup**: Configured for Freighter Wallet and connects to the Stellar Testnet via `WalletNetwork.TESTNET`.
2. **Wallet Connection**: A "Connect Wallet" button opens the Stellar Wallets Kit multi-wallet modal (supports Freighter, Albedo, xBull). A "Disconnect" button clears all wallet state.
3. **Balance Handling**: After connecting, the app queries `horizon-testnet.stellar.org` to fetch the native XLM balance and displays it formatted to 4 decimal places in the header. Unfunded accounts show `0.0000 XLM (Unfunded)`.
4. **Transaction Flow – Send XLM**: A dedicated **"Send XLM on Testnet"** panel in the Overview tab lets users enter a destination address, amount, and optional memo, then:
   - Builds a `Operation.payment` with `Asset.native()` signed by the connected wallet.
   - Submits it to Horizon Testnet via `horizonServer.submitTransaction()`.
   - Shows inline ✅ success / ❌ failure state with the transaction hash.
   - Displays a clickable **StellarExpert** link: `https://stellar.expert/explorer/testnet/tx/<hash>`.
5. **Development Standards**: Pure JS/HTML/CSS, no build step. Uses `@creit.tech/stellar-wallets-kit` and `@stellar/stellar-sdk` loaded via ESM CDN with an importmap.


---

## 1. Smart Contract Architecture

The protocol is built using a Soroban smart contract in Rust, running on **Stellar Testnet**.

### State Machine Lifecycle
The escrow agreement follows a strict linear state transition flow:
```
  [CREATED] ──(fund_engagement)──> [FUNDED] ──(submit_work)──> [WORK_SUBMITTED] ──(approve_work)──> [APPROVED] ──> [COMPLETED]
```
- **CREATED**: Agreement is initialized by the client with developer address, asset, payment amount, and deadline.
- **FUNDED**: Escrow amount is transferred from the client's wallet to the contract's secure escrow storage.
- **WORK_SUBMITTED**: Developer submits proof of work (deliverable URL, PR, commit hash, note) to the ledger.
- **APPROVED**: Client reviews deliverables, approves them, and triggers payment release.
- **COMPLETED**: The contract transfers the escrow balance to the developer and marks the agreement closed.

### Storage Model & TTL
- **Instance Storage**: Stores the global counter `NextId`. Re-extended by `extend_ttl` on every new agreement creation.
- **Persistent Storage**: Stores the `Engagement` struct for each unique ID. Keys are extended by 100 ledgers (up to 518,400 ledgers threshold) on every interaction to prevent storage expiration.

---

## 2. Contract API & Functions

### `create_engagement(client: Address, developer: Address, token: Address, amount: i128, deadline: u64) -> u64`
- **Authorized by**: Client.
- **Action**: Registers a new agreement. Returns the generated engagement ID.

### `fund_engagement(id: u64, client: Address)`
- **Authorized by**: Client.
- **Action**: Transfers `amount` of the designated Stellar `token` asset from the client to the contract's escrow address, then moves status to `FUNDED`.

### `submit_work(id: u64, developer: Address, work_url: String, work_pr_url: String, work_commit: String, work_note: String)`
- **Authorized by**: Developer.
- **Action**: Records the deliverable proof on-chain and moves status to `WORK_SUBMITTED`.

### `approve_work(id: u64, client: Address)`
- **Authorized by**: Client.
- **Action**: Advances state to `APPROVED`, transfers the escrowed tokens to the developer, and sets status to `COMPLETED`.

---

## 3. Emitted Events

All contract transitions publish events for frontend activity logging:
- **`created`**: `(symbol_short!("created"), id) -> (client, developer, amount)`
- **`funded`**: `(symbol_short!("funded"), id) -> client`
- **`submitted`**: `(symbol_short!("submitted"), id) -> developer`
- **`approved`**: `(symbol_short!("approved"), id) -> client`
- **`released`**: `(symbol_short!("released"), id) -> (developer, amount)`
- **`completed`**: `(symbol_short!("completed"), id) -> ()`

---

## 4. Local Setup & Testing

### Prerequisites
- Rust and Cargo (`stable-x86_64-pc-windows-gnu` or `stable-x86_64-pc-windows-msvc` toolchains).
- Cargo tests require an assembler (`as.exe`) installed on the host machine (e.g. via LLVM MinGW).

### Run Contract Tests
Execute the comprehensive test suite verifying the happy path and all 7 negative security checks (unauthorized access, invalid states, double payments):
```bash
cargo test
```

### Build Contract WASM
Compile the contract to WebAssembly for deployment:
```bash
cargo build --target wasm32-unknown-unknown --release
```

---

## 5. Deploys & Stellar Testnet

### Live Deployed Addresses
- **Vouchsafe Contract ID**: `CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR`
- **Native XLM Token SAC ID**: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- **Deployer Account Address**: `GBCQI56TO2T27F3I4XRZK72NSUFRJAM4M7ZIBCNA35O4W5F7WIJU4VKO`

### Deploying the Smart Contract
To deploy the contract to the Stellar Testnet:
1. Generate deployer identity and fund it:
   ```bash
   stellar keys generate vouchsafe-deployer --network testnet --fund
   ```
2. Build the WASM target:
   ```bash
   cargo build --target wasm32-unknown-unknown --release
   ```
3. Deploy to Testnet:
   ```bash
   stellar contract deploy \
     --network testnet \
     --source vouchsafe-deployer \
     --wasm target/wasm32-unknown-unknown/release/vouchsafe.wasm
   ```

### Running the Frontend
1. Open the directory `Vouchsafe` using a local HTTP server (e.g. `python -m http.server 8000`).
2. Open `http://localhost:8000` in your browser.
3. Install the **Freighter Wallet** browser extension and switch its network setting to **Testnet**.
4. The frontend will automatically load the deployed Contract ID `CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR` by default. Switch roles and test the on-chain state machine!
