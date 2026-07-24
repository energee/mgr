/**
 * send-email Edge Function
 *
 * Sends transactional emails via the Resend API. Called by pg_net from the
 * dispatch_email_notification() database function whenever a notification is
 * created for a user who has email_enabled = true in their preferences.
 *
 * Environment variables:
 *   RESEND_API_KEY  - Resend API key for sending emails
 *   EMAIL_FROM      - Sender address (default: "MGR Brewery <notifications@brewery.com>")
 *
 * Authentication: Requires a valid Authorization header. When called from
 * pg_net the service_role key is passed automatically.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type EmailPayload = {
  /** Recipient email address */
  to: string;
  /** Email subject line */
  subject: string;
  /** HTML body content */
  html: string;
  /** Optional plain-text body (fallback for non-HTML clients) */
  text?: string;
};

Deno.serve(async (req: Request) => {
  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify request has authorization (service_role key from pg_net)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const payload: EmailPayload = await req.json();
    const { to, subject, html, text } = payload;

    // Validate required fields
    if (!to || !subject || !html) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: to, subject, html",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Validate email format (basic check)
    if (!to.includes("@")) {
      return new Response(
        JSON.stringify({ error: "Invalid email address" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("[send-email] RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const emailFrom =
      Deno.env.get("EMAIL_FROM") ||
      "MGR Brewery <notifications@brewery.com>";

    // Send via Resend API
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [to],
        subject,
        html,
        text: text || undefined,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[send-email] Resend API error:", result);
      return new Response(
        JSON.stringify({
          error: "Failed to send email",
          details: result,
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    console.log(`[send-email] Sent to ${to}: ${result.id}`);

    return new Response(
      JSON.stringify({ success: true, id: result.id }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Connection: "keep-alive",
        },
      },
    );
  } catch (error) {
    console.error("[send-email] Internal error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
