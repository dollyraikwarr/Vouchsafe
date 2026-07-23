// Vouchsafe "Live Proof" widget.
//
// This queries the REAL Soroban Testnet RPC for the deployed Vouchsafe
// contract's actual event history and renders whatever it finds — no
// fabricated data. If you've run `node testnet_e2e.js` yourself and want
// specific known-good hashes pinned at the top regardless of RPC retention
// windows, paste them into KNOWN_TX_HASHES below.
//
// Scoped entirely to #liveProofList — does not touch app.js's state.

import * as StellarSdk from "https://esm.sh/@stellar/stellar-sdk@14?bundle";
import * as rpcNamespace from "https://esm.sh/@stellar/stellar-sdk@14/rpc?bundle";

const RPC_URL = "https://soroban-testnet.stellar.org";
const CONTRACT_ID = "CBHLS5OKZWPYZTQA2DH66OJZMD6IZ7U54DVNM3DP5M4R3FSHOOTXMKTR";
const EXPLORER_TX = (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

// Optional: paste real hashes from a `node testnet_e2e.js` run here, e.g.
// { type: "released", id: "482", hash: "abcd1234..." }
// These render pinned above whatever the live RPC query finds.
const KNOWN_TX_HASHES = [];

// Soroban RPC only retains events for a limited ledger window on testnet.
// Look back far enough to have a reasonable chance of finding something,
// but stay within typical retention (~a few days of ledgers).
const LOOKBACK_LEDGERS = 17280; // roughly the last ~24h at ~5s/ledger

function truncate(id, front = 8, back = 8) {
  if (!id || id.length <= front + back + 1) return id;
  return `${id.slice(0, front)}…${id.slice(-back)}`;
}

function badgeClassFor(type) {
  const known = ["created", "funded", "submitted", "approved", "released", "completed"];
  return known.includes(type) ? `live-proof-badge-${type}` : "live-proof-badge-pinned";
}

function renderRow({ type, id, hash }) {
  const row = document.createElement("div");
  row.className = "live-proof-row";
  row.innerHTML = `
    <span class="live-proof-badge ${badgeClassFor(type)}">${type}</span>
    <span class="mono live-proof-id">engagement #${id ?? "—"}</span>
    <a class="live-proof-link" href="${EXPLORER_TX(hash)}" target="_blank" rel="noopener">${truncate(hash)} ↗</a>
  `;
  return row;
}

function renderMessage(container, text, cls) {
  const el = document.createElement("div");
  el.className = cls;
  el.innerHTML = text;
  container.appendChild(el);
}

async function loadLiveProof() {
  const container = document.getElementById("liveProofList");
  if (!container) return;

  container.innerHTML = "";

  KNOWN_TX_HASHES.forEach((entry) => container.appendChild(renderRow(entry)));

  try {
    const rpcServer = new rpcNamespace.Server(RPC_URL);
    const latestLedgerResponse = await rpcServer.getLatestLedger();
    const latestLedger = latestLedgerResponse.sequence;
    const startLedger = Math.max(1, latestLedger - LOOKBACK_LEDGERS);

    const response = await rpcServer.getEvents({
      startLedger,
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      limit: 20,
    });

    const events = (response.events || []).slice().reverse(); // newest first

    if (events.length === 0 && KNOWN_TX_HASHES.length === 0) {
      renderMessage(
        container,
        `No recorded activity in the current RPC retention window. That just means no one's run an engagement recently — <a href="#app">launch the app</a> and make the first entry yourself, or view the contract's full history on <a href="${EXPLORER_TX(CONTRACT_ID).replace("/tx/", "/contract/")}" target="_blank" rel="noopener">stellar.expert ↗</a>.`,
        "live-proof-empty"
      );
      return;
    }

    events.forEach((evt) => {
      try {
        const topics = evt.topic.map((t) => StellarSdk.scValToNative(t));
        const type = String(topics[0] ?? "event").toLowerCase();
        const id = topics[1] !== undefined ? String(topics[1]) : undefined;
        container.appendChild(renderRow({ type, id, hash: evt.txHash }));
      } catch (innerErr) {
        console.warn("Vouchsafe live-proof: could not decode one event", innerErr);
      }
    });
  } catch (err) {
    console.error("Vouchsafe live-proof: RPC query failed", err);
    if (KNOWN_TX_HASHES.length === 0) {
      renderMessage(
        container,
        `Couldn't reach Soroban RPC just now. You can still <a href="${EXPLORER_TX(CONTRACT_ID).replace("/tx/", "/contract/")}" target="_blank" rel="noopener">view the contract directly on stellar.expert ↗</a>.`,
        "live-proof-error"
      );
    }
  }
}

loadLiveProof();
