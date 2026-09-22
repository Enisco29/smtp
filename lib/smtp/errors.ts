export type SmtpErrorShape = { code?: string; responseCode?: number };

export function smtpErrorMessage(error: SmtpErrorShape) {
  if (error.code === "EAUTH" || error.responseCode === 534 || error.responseCode === 535) {
    return "Google rejected these credentials. Use a Google App Password, not your normal password. If this is a Workspace account, your administrator may have disabled App Passwords.";
  }
  if (["ETIMEDOUT", "ECONNECTION", "ESOCKET", "ECONNREFUSED"].includes(error.code ?? "")) {
    return "We could not reach Gmail. Check your connection and try again in a moment.";
  }
  return "Gmail could not verify these credentials. Confirm the address and App Password, then try again.";
}
