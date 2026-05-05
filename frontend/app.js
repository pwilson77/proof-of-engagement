import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  PoeClient,
  PROGRAM_ID,
  deserializeCampaign,
  statusLabel,
} from "@poe/sdk";
import { sha256 } from "@noble/hashes/sha2.js";

// ---------------------------------------------------------------------------
// Account discriminators (Anchor: sha256("account:<StructName>")[0..8])
// ---------------------------------------------------------------------------
function accountDisc(name) {
  return Array.from(sha256(new TextEncoder().encode(`account:${name}`))).slice(
    0,
    8,
  );
}
const CAMPAIGN_DISC = accountDisc("Campaign");
const VALIDATOR_SCORE_DISC = accountDisc("ValidatorScore");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let connection = null;
let poeClient = null;
let payer = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function pubkey(s) {
  return new PublicKey(s.trim());
}
function hexToBytes(hex) {
  if (hex.length !== 64) throw new Error("taskRef must be 64 hex chars");
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++)
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}
function fmtBps(bps) {
  return `${(bps / 100).toFixed(2)}%`;
}
function fmtUnix(unix) {
  return new Date(Number(unix) * 1000).toLocaleString();
}

function badge(label) {
  return `<span class="status-badge badge-${label}">${label.replace("_", " ")}</span>`;
}

// ---------------------------------------------------------------------------
// Connect & load all campaigns
// ---------------------------------------------------------------------------
window.connectAndLoad = async function () {
  const url = document.getElementById("rpc-url").value.trim();
  const statusEl = document.getElementById("wallet-status");
  const listEl = document.getElementById("campaign-list");
  const countEl = document.getElementById("campaign-count");
  const refreshBtn = document.getElementById("refresh-btn");

  try {
    connection = new Connection(url, "confirmed");
    const slot = await connection.getSlot();
    if (!payer) payer = Keypair.generate();
    poeClient = new PoeClient({ connection, payer });

    statusEl.textContent = `Connected — slot ${slot} — ephemeral payer: ${payer.publicKey.toBase58()}`;
    refreshBtn.style.display = "";
    countEl.textContent = "";
    listEl.innerHTML = `<div class="empty-state"><span class="spinner"></span>Loading campaigns…</div>`;

    await loadCampaigns();
  } catch (e) {
    statusEl.textContent = `Connection failed: ${e.message}`;
  }
};

window.loadCampaigns = async function () {
  if (!connection) return;
  const listEl = document.getElementById("campaign-list");
  const countEl = document.getElementById("campaign-count");

  listEl.innerHTML = `<div class="empty-state"><span class="spinner"></span>Fetching accounts…</div>`;

  let accounts;
  try {
    // Fetch all accounts owned by the program, then filter by Campaign discriminator in JS.
    // This avoids memcmp encoding subtleties and works reliably with the local test validator.
    accounts = await connection.getProgramAccounts(PROGRAM_ID);
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state">Failed to fetch accounts: ${escapeHtml(e.message)}</div>`;
    return;
  }

  // Keep only Campaign accounts (discriminator match)
  const campaignAccounts = accounts.filter(({ account }) => {
    const d = account.data;
    if (d.length < 8) return false;
    for (let i = 0; i < 8; i++) if (d[i] !== CAMPAIGN_DISC[i]) return false;
    return true;
  });

  if (campaignAccounts.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No campaigns found on this cluster.</div>`;
    countEl.textContent = "0 campaigns";
    return;
  }

  countEl.textContent = `${campaignAccounts.length} campaign${campaignAccounts.length !== 1 ? "s" : ""}`;

  // Deserialize
  const parsed = campaignAccounts
    .map(({ pubkey: pda, account }) => {
      try {
        const acct = deserializeCampaign(account.data);
        return { pda, acct };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // Sort newest first
  parsed.sort((a, b) => (a.acct.campaignId < b.acct.campaignId ? 1 : -1));

  // Render
  listEl.innerHTML = parsed
    .map(({ pda, acct }) => {
      const sl = statusLabel(acct);
      const creatorShort = acct.creator.toBase58();
      const idxId = `c-${pda.toBase58()}`;
      return `
      <div class="campaign-row" id="${idxId}">
        <div class="campaign-summary" onclick="toggleCampaign('${idxId}', '${acct.creator.toBase58()}', '${acct.campaignId}')">
          <span class="c-id">#${acct.campaignId}</span>
          <span class="c-creator" title="${creatorShort}">${creatorShort}</span>
          <span class="c-deadline">⏱ ${fmtUnix(acct.deadlineUnix)}</span>
          ${badge(sl)}
          <span class="chevron">▶</span>
        </div>
        <div class="campaign-detail" id="${idxId}-detail">
          <div class="detail-grid">
            <div>
              <div class="field-row"><span class="field-label">Campaign ID</span><span class="field-val">${acct.campaignId}</span></div>
              <div class="field-row"><span class="field-label">Status</span><span class="field-val">${badge(sl)}</span></div>
              <div class="field-row"><span class="field-label">Creator</span><span class="field-val">${acct.creator.toBase58()}</span></div>
              <div class="field-row"><span class="field-label">Executor</span><span class="field-val">${acct.executor.toBase58()}</span></div>
            </div>
            <div>
              <div class="field-row"><span class="field-label">Amount (raw)</span><span class="field-val">${acct.amount}</span></div>
              <div class="field-row"><span class="field-label">Threshold</span><span class="field-val">${fmtBps(acct.thresholdBps)}</span></div>
              <div class="field-row"><span class="field-label">Deadline</span><span class="field-val">${fmtUnix(acct.deadlineUnix)}</span></div>
              <div class="field-row"><span class="field-label">Validators</span><span class="field-val">${acct.validatorCount}</span></div>
            </div>
            <div>
              <div class="field-row"><span class="field-label">Escrow ATA</span><span class="field-val">${acct.escrowTokenAccount.toBase58()}</span></div>
              <div class="field-row"><span class="field-label">Campaign PDA</span><span class="field-val">${pda.toBase58()}</span></div>
            </div>
          </div>
          <div id="${idxId}-scores">
            <p style="font-size:.82rem;color:#a0a0c0">Loading scores…</p>
          </div>
          <div class="detail-actions" id="${idxId}-actions">
            ${
              sl === "open"
                ? `
              <button class="secondary" onclick="showSettleInputs('${idxId}', 'success')">Settle Success</button>
              <button class="secondary" onclick="settleTimeoutInline('${idxId}', '${acct.creator.toBase58()}', '${acct.campaignId}')">Settle Timeout Refund</button>
              <div class="settle-extra" id="${idxId}-settle-extra">
                <div>
                  <label>Executor ATA</label>
                  <input id="${idxId}-executor-ata" placeholder="Executor token account pubkey" />
                </div>
                <div>
                  <label>Score Account Pubkeys (one per line)</label>
                  <textarea id="${idxId}-score-accounts" placeholder="Score PDA pubkeys, one per line"></textarea>
                </div>
                <button class="primary" onclick="settleSuccessInline('${idxId}', '${acct.creator.toBase58()}', '${acct.campaignId}')">Confirm Settle Success</button>
              </div>
            `
                : ""
            }
            <div class="action-log info" id="${idxId}-log" style="display:none"></div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  // Load scores for all campaigns async
  for (const { pda, acct } of parsed) {
    loadScores(pda, acct.creator, acct.campaignId, acct.validatorCount);
  }
};

// ---------------------------------------------------------------------------
// Toggle row open/closed
// ---------------------------------------------------------------------------
window.toggleCampaign = function (id) {
  const row = document.getElementById(id);
  if (!row) return;
  row.classList.toggle("open");
};

// ---------------------------------------------------------------------------
// Load validator scores for one campaign
// ---------------------------------------------------------------------------
async function loadScores(pda, creator, campaignId, validatorCount) {
  const elId = `c-${pda.toBase58()}-scores`;
  const el = document.getElementById(elId);
  if (!el || !poeClient) return;

  try {
    const result = await poeClient.queryCampaignStatus(creator, campaignId);
    if (result.scores.length === 0) {
      el.innerHTML = `<p style="font-size:.82rem;color:#a0a0c0">No validator scores yet.</p>`;
    } else {
      const rows = result.scores
        .map((s) => {
          const pct = Math.round((s.scoreBps / 10000) * 100);
          return `
          <div class="score-row">
            <span class="score-validator" title="${s.validator.toBase58()}">${s.validator.toBase58()}</span>
            <div class="score-bar-wrap"><div class="score-bar" style="width:${pct}%"></div></div>
            <span class="score-val">${fmtBps(s.scoreBps)}</span>
          </div>`;
        })
        .join("");
      el.innerHTML = `<p class="scores-title">Validator Scores</p>${rows}`;
    }
  } catch {
    el.innerHTML = `<p style="font-size:.82rem;color:#a0a0c0">Could not load scores.</p>`;
  }
}

// ---------------------------------------------------------------------------
// Settlement helpers (inline, per campaign row)
// ---------------------------------------------------------------------------
window.showSettleInputs = function (id, mode) {
  const extra = document.getElementById(`${id}-settle-extra`);
  if (extra) extra.classList.toggle("visible");
};

window.settleSuccessInline = async function (id, creatorStr, campaignIdStr) {
  if (!poeClient) return;
  const logEl = document.getElementById(`${id}-log`);
  logEl.style.display = "";
  logEl.className = "action-log info";
  logEl.textContent = "Sending settle_success…";

  try {
    const creator = pubkey(creatorStr);
    const campaignId = BigInt(campaignIdStr);
    const executorAta = pubkey(
      document.getElementById(`${id}-executor-ata`).value.trim(),
    );
    const scoreAccounts = (
      document.getElementById(`${id}-score-accounts`).value || ""
    )
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(pubkey);

    const receipt = await poeClient.triggerSettleSuccess(
      creator,
      campaignId,
      executorAta,
      scoreAccounts,
    );
    logEl.className = "action-log";
    logEl.textContent = `✓ Settled — tx: ${receipt.txSignature}`;
    await loadCampaigns(); // refresh list
  } catch (e) {
    logEl.className = "action-log error";
    logEl.textContent = `Error: ${e.message}`;
  }
};

window.settleTimeoutInline = async function (id, creatorStr, campaignIdStr) {
  if (!poeClient) return;
  const logEl = document.getElementById(`${id}-log`);
  logEl.style.display = "";
  logEl.className = "action-log info";
  logEl.textContent = "Sending settle_timeout_refund…";

  try {
    const creator = pubkey(creatorStr);
    const campaignId = BigInt(campaignIdStr);
    const result = await poeClient.queryCampaignStatus(creator, campaignId);
    const mint = result.account.mint;
    const creatorRefundAta = await getAssociatedTokenAddress(mint, creator);
    const receipt = await poeClient.triggerTimeoutRefund(
      creator,
      campaignId,
      creatorRefundAta,
    );
    logEl.className = "action-log";
    logEl.textContent = `✓ Refund settled — tx: ${receipt.txSignature}`;
    await loadCampaigns(); // refresh list
  } catch (e) {
    logEl.className = "action-log error";
    logEl.textContent = `Error: ${e.message}`;
  }
};

// ---------------------------------------------------------------------------
// Create Campaign
// ---------------------------------------------------------------------------
window.createCampaign = async function () {
  const logEl = document.getElementById("cc-log");
  if (!poeClient) {
    logEl.className = "cc-log error";
    logEl.textContent = "Not connected to RPC.";
    return;
  }
  try {
    logEl.className = "cc-log info";
    logEl.textContent = "Building transaction…";

    const campaignId = BigInt(document.getElementById("cc-id").value);
    const amount = BigInt(document.getElementById("cc-amount").value);
    const thresholdBps = parseInt(
      document.getElementById("cc-threshold").value,
      10,
    );
    const deadlineUnix = BigInt(document.getElementById("cc-deadline").value);
    const executor = pubkey(document.getElementById("cc-executor").value);
    const validators = document
      .getElementById("cc-validators")
      .value.split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(pubkey);
    const taskRef = hexToBytes(
      document.getElementById("cc-taskref").value.trim(),
    );

    logEl.textContent = "Sending transaction…";
    const receipt = await poeClient.createCampaign({
      campaignId,
      executor,
      amount,
      taskRef,
      validators,
      thresholdBps,
      deadlineUnix,
    });
    logEl.className = "cc-log ok";
    logEl.textContent = `✓ Campaign created — tx: ${receipt.txSignature}\nRefreshing…`;
    await loadCampaigns();
  } catch (e) {
    logEl.className = "cc-log error";
    logEl.textContent = `Error: ${e.message}`;
  }
};

// ---------------------------------------------------------------------------
// URL param: auto-connect if ?rpc=... provided
// ---------------------------------------------------------------------------

async function onReady() {
  const p = new URLSearchParams(window.location.search);
  const rpcParam = p.get("rpc");
  if (rpcParam) {
    document.getElementById("rpc-url").value = rpcParam;
    await window.connectAndLoad();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", onReady);
} else {
  onReady();
}
