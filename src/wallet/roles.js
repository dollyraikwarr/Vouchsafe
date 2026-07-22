/**
 * Wallet Slot and Role Signing Guard Management
 */
export const clientWallet = { address: null, providerId: null };
export const developerWallet = { address: null, providerId: null };

export function getWalletSlot(role) {
  return role === "client" ? clientWallet : developerWallet;
}

export function setWalletSlot(role, address, providerId) {
  if (role === "client") {
    clientWallet.address = address;
    clientWallet.providerId = providerId;
  } else {
    developerWallet.address = address;
    developerWallet.providerId = providerId;
  }
}

export function clearWalletSlot(role) {
  setWalletSlot(role, null, null);
}

export function requireSigningWallet(role, kit) {
  const slot = getWalletSlot(role);
  if (!slot.address || !slot.providerId) {
    const err = new Error(`Please connect your ${role} wallet first.`);
    err.code = "NO_WALLET";
    throw err;
  }
  if (kit) {
    kit.setWallet(slot.providerId);
  }
  return slot.address;
}
