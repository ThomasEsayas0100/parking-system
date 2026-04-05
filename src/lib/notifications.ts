// Notification stubs — replace with actual Twilio / SendGrid / Resend integrations

export async function sendSMS(to: string, message: string) {
  console.log(`[SMS → ${to}] ${message}`);
  // TODO: integrate Twilio
}

export async function sendEmail(to: string, subject: string, body: string) {
  console.log(`[EMAIL → ${to}] ${subject}: ${body}`);
  // TODO: integrate Resend or SendGrid
}
