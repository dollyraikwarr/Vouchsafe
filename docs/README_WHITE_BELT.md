# Vouchsafe — White Belt Documentation (Level 1)

> **Belt Level**: ⚪ White Belt  
> **Status**: ✅ COMPLETED  
> **Target Network**: Stellar Testnet  
> **Live Demo**: [https://vouchsafe-eight.vercel.app ↗](https://vouchsafe-eight.vercel.app)  

---

## 1. Project Description

**Vouchsafe** is an on-chain escrow payment protocol built on the Stellar Testnet using Soroban smart contracts. It eliminates payment risk in technical freelance work and software deliverables.

### Problem Solved
Traditional freelance payments suffer from a fundamental trust gap:
- **Developers** risk non-payment or delayed payout after spending time delivering work.
- **Clients** risk non-delivery or low-quality work when paying upfront.

### Solution
Vouchsafe locks payment funds in a Soroban escrow contract before work begins. The payment is released to the developer's wallet only after the developer submits verifiable proof of work (GitHub commit hash, PR link, deliverable URL) and the client explicitly approves the completed deliverable.

---

## 2. Setup Instructions (How to Run Locally)

Follow these steps to run the Vouchsafe application and test suites on your local machine.

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [Rust & Cargo](https://www.rust-lang.org/) (with `wasm32-unknown-unknown` target installed)

### Step 1: Clone Repository
```bash
git clone https://github.com/dollyraikwarr/Vouchsafe.git
cd Vouchsafe
```

### Step 2: Run Frontend Unit Test Suite
```bash
npm test
```
*Executes the 7 frontend unit tests (error classification, formatting, role signing guards, event deduplication).*

### Step 3: Run Smart Contract Unit Tests
```bash
cargo test --workspace
```
*Executes the 14 Rust unit tests across the Vouchsafe workspace.*

### Step 4: Launch Local Application Server
```bash
npx serve . -p 8000
```
Open `http://localhost:8000` in your web browser to interact with the live dApp connected to Stellar Testnet.

---

## 3. Required Level 1 Submission Screenshots

All screenshots below are captured from the **current live application** running on Stellar Testnet.

---

### 📸 1. Application Landing Page
The Vouchsafe hero section showing the brand, navigation, and **Connect Wallet** button in the top navbar:

![Landing Page](images/00_landing_page.png)

---

### 📸 2. Wallet Connected State — Multi-Wallet Selection Modal
Demonstrates the **StellarWalletsKit** wallet selection modal, supporting **Albedo**, **xBull**, **HOT Wallet**, **Freighter**, and more on Stellar Testnet. The dashboard with Configuration section and Create Engagement form are visible behind the modal:

![Wallet Selection Modal](images/02_wallet_modal.png)

---

### 📸 3. Balance Displayed — Dashboard with XLM Balance Badge
Demonstrates the live XLM balance fetched from Stellar Horizon Testnet (`fetchAndDisplayBalance()`), pre-filled native XLM SAC contract address, and the full dual-panel escrow dashboard showing Configuration, Create Engagement form, Engagement Details panel, and On-Chain Transaction Logs:

![Dashboard with Balance](images/01_wallet_connected.png)

---

### 📸 4. Successful Testnet Transaction — Transaction Result Shown to User
Demonstrates the Engagement Details panel, status feedback banner (success/error states), and On-Chain Transaction Logs table with transaction hashes and StellarExpert explorer links. The status banner provides real-time confirmation of on-chain events:

![Transaction Result & Logs](images/03_successful_transaction.png)

---

### 📸 5. Full Application View
Full-page view of the complete Vouchsafe dApp including the landing marketing section and the full escrow dashboard:

![Full Application View](images/04_full_app.png)

---

## 4. Official Level 1 Audit Requirements Verification Matrix

| Requirement | Implementation Detail | Verification Status |
|-------------|-----------------------|---------------------|
| **1. Wallet Setup** | Supports Freighter, Albedo, and xBull on Stellar Testnet via `@creit.tech/stellar-wallets-kit`. | ✅ **PASS** |
| **2. Wallet Connection & Disconnect** | Interactive `Connect Wallet` modal trigger & `Disconnect` button clearing session state (`disconnectWallet()`). | ✅ **PASS** |
| **3. Balance Handling** | Live XLM balance query from Horizon Testnet API (`fetchAndDisplayBalance()`) displayed in top navbar badge (`walletBalance`). | ✅ **PASS** |
| **4. Transaction Flow** | Sends contract escrow & token transactions on Stellar Testnet with status feedback & StellarExpert tx hash links. | ✅ **PASS** |
| **5. Development Standards** | Clean modular JS structure (`src/`), Node native test suite (`npm test`), and fully responsive UI. | ✅ **PASS** |
| **6. Submission Checklist** | Public GitHub repo (`dollyraikwarr/Vouchsafe`), setup guide, and screenshot media artifacts. | ✅ **PASS** |

---

## 5. System Architecture & Smart Contract Specs

### Soroban Escrow State Machine Progression
```
    [CREATED]
        │  fund_engagement(id, client)
        ▼
    [FUNDED]
        │  submit_work(id, developer, work_url, work_pr_url, work_commit, work_note)
        ▼
[WORK_SUBMITTED]
        │  approve_work(id, client)
        ▼
   [COMPLETED]  <-- Atomic payout released to developer wallet
```

### Deployed Contract Information
- **Engagement Contract ID**: `CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR`
- **Native XLM SAC Address**: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- **StellarExpert Explorer**: [View Contract Details ↗](https://stellar.expert/explorer/testnet/contract/CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR)

