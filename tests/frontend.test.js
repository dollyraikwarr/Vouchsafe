import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyError, ErrorType } from '../src/utils/errors.js';
import { stroopsToXlm, xlmToStroops, truncateAddr, getStatusString } from '../src/utils/formatting.js';
import { clientWallet, developerWallet, setWalletSlot, clearWalletSlot, requireSigningWallet } from '../src/wallet/roles.js';
import { createEventKey, isEventDisplayed, markEventDisplayed, resetEvents } from '../src/contract/events.js';

test('Error Classifier — User Rejection', () => {
  const err = { code: 4001, message: 'User rejected the request' };
  const classified = classifyError(err);
  assert.equal(classified.type, ErrorType.USER_REJECTED);
  assert.equal(classified.title, 'Transaction Cancelled');
});

test('Error Classifier — Wallet Unavailable', () => {
  const err = { code: 'NO_WALLET', message: 'Wallet extension not installed' };
  const classified = classifyError(err);
  assert.equal(classified.type, ErrorType.WALLET_UNAVAILABLE);
  assert.equal(classified.title, 'Wallet Not Available');
});

test('Error Classifier — Insufficient Balance', () => {
  const err = { response: { data: { extras: { result_codes: { operations: ['op_underfunded'] } } } } };
  const classified = classifyError(err);
  assert.equal(classified.type, ErrorType.INSUFFICIENT_BALANCE);
  assert.equal(classified.title, 'Insufficient Balance');
});

test('Formatting Utilities — Stroops/XLM Conversion', () => {
  assert.equal(stroopsToXlm(10000000n), '1.00');
  assert.equal(xlmToStroops('1.5'), 15000000n);
  assert.equal(truncateAddr('GBCQI56TO2T27F3I4XRZK72NSUFRJAM4M7ZIBCNA35O4W5F7WIJU4VKO'), 'GBCQI5…JU4VKO');
  assert.equal(getStatusString(0), 'Created');
  assert.equal(getStatusString(1), 'Funded');
  assert.equal(getStatusString(5), 'Cancelled');
  assert.equal(getStatusString(6), 'Expired');
});

test('Role Signing Guard — Throws when slot is empty', () => {
  clearWalletSlot('client');
  assert.throws(() => {
    requireSigningWallet('client', null);
  }, { code: 'NO_WALLET' });
});

test('Role Signing Guard — Returns address when slot is connected', () => {
  setWalletSlot('developer', 'GDEV1234567890123456789012345678901234567890123456789012', 'albedo');
  const addr = requireSigningWallet('developer', null);
  assert.equal(addr, 'GDEV1234567890123456789012345678901234567890123456789012');
  assert.equal(developerWallet.providerId, 'albedo');
});

test('Event Deduplication Engine — Prevents duplicate event keys', () => {
  resetEvents();
  const key = createEventKey('txhash123', 'created', 1);
  assert.equal(key, 'txhash123:created:1');
  assert.equal(isEventDisplayed('txhash123', 'created', 1), false);
  markEventDisplayed('txhash123', 'created', 1);
  assert.equal(isEventDisplayed('txhash123', 'created', 1), true);
});
