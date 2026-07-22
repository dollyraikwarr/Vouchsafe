/**
 * Error Types and Code-First Error Classification Engine
 */
export const ErrorType = Object.freeze({
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

export function classifyError(err) {
  // 1. Horizon result codes
  const resultCodes = err?.response?.data?.extras?.result_codes;
  if (resultCodes) {
    const opCodes = resultCodes.operations || [];
    const txCode  = resultCodes.transaction || "";

    if (opCodes.includes("op_underfunded") || txCode === "tx_insufficient_balance") {
      return {
        type: ErrorType.INSUFFICIENT_BALANCE,
        title: "Insufficient Balance",
        message: "Your wallet does not have enough XLM or tokens to fund this transaction.",
        action: "Fund your Testnet wallet at laboratory.stellar.org or use Friendbot.",
      };
    }
    if (opCodes.includes("op_no_trust")) {
      return {
        type: ErrorType.INSUFFICIENT_BALANCE,
        title: "Token Not Trusted",
        message: "Your wallet has not established a trustline for this token.",
        action: "Add a trustline for the token before funding.",
      };
    }
    if (txCode === "tx_bad_auth" || opCodes.includes("op_bad_auth")) {
      return {
        type: ErrorType.USER_REJECTED,
        title: "Authorization Failed",
        message: "The transaction was not properly authorized. You may have signed with the wrong wallet.",
        action: "Make sure you are signing with the correct role wallet.",
      };
    }
  }

  // 2. RPC simulation / contract panics
  const rpcError = err?.response?.error || err?.error;
  if (rpcError) {
    const rpcMsg = String(rpcError).toLowerCase();
    if (rpcMsg.includes("invalid state")) {
      return {
        type: ErrorType.INVALID_STATE,
        title: "Invalid Contract State",
        message: "This action cannot be performed in the current status.",
        action: "Refresh the engagement list.",
      };
    }
  }

  // 3. Wallet codes and message strings
  const errMsg = String(err?.message || err || "").toLowerCase();
  const errCode = err?.code;

  if (errCode === -1 || errCode === 4001 || errMsg.includes("user rejected") || errMsg.includes("user denied") || errMsg.includes("cancelled")) {
    return {
      type: ErrorType.USER_REJECTED,
      title: "Transaction Cancelled",
      message: "You rejected the transaction in your wallet.",
      action: "Click the action button again if you'd like to try.",
    };
  }

  if (errCode === "NO_WALLET" || errMsg.includes("no wallet") || errMsg.includes("not installed") || errMsg.includes("wallet not found")) {
    return {
      type: ErrorType.WALLET_UNAVAILABLE,
      title: "Wallet Not Available",
      message: "The selected wallet is not installed or cannot be accessed.",
      action: "Install the extension or choose Albedo.",
    };
  }

  if (errMsg.includes("insufficient") || errMsg.includes("underfunded")) {
    return {
      type: ErrorType.INSUFFICIENT_BALANCE,
      title: "Insufficient Balance",
      message: "Your wallet does not have enough funds for this transaction.",
      action: "Fund your wallet using Friendbot.",
    };
  }

  if (errMsg.includes("caller must be")) {
    return {
      type: ErrorType.WRONG_ROLE,
      title: "Wrong Role",
      message: "This action requires authorization from a different role wallet.",
      action: "Connect the correct wallet role.",
    };
  }

  return {
    type: ErrorType.UNKNOWN,
    title: "Unexpected Error",
    message: err?.message || String(err) || "An unexpected error occurred.",
    action: "Try again or check browser console.",
  };
}
