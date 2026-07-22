/**
 * Formatting and Conversion Utilities
 */
export function stroopsToXlm(stroops) {
  return (Number(stroops) / 10000000).toFixed(2);
}

export function xlmToStroops(xlm) {
  return BigInt(Math.round(Number(xlm) * 10000000));
}

export function truncateAddr(addr) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

export function getStatusString(status) {
  if (status && typeof status === "object") {
    return status.name || Object.keys(status)[0] || "Created";
  }
  if (typeof status === "string") return status;
  const map = ["Created", "Funded", "WorkSubmitted", "Approved", "Completed", "Cancelled", "Expired"];
  return map[Number(status)] || "Created";
}
