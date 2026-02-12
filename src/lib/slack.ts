/**
 * Slack Notification Delivery
 *
 * Server-side utility for formatting and sending Slack messages
 * via Block Kit and Incoming Webhooks.
 */

// -- Types --------------------------------------------------------------------

export interface SlackSettings {
  webhook_url: string | null;
  default_channel: string | null;
  is_enabled: boolean;
  channel_overrides: Record<string, string>;
}

export interface SlackNotification {
  type: string;
  title: string;
  message: string | null;
  priority: string;
  action_url: string | null;
  metadata: Record<string, unknown>;
}

// -- Emoji mapping for notification types ------------------------------------

const TYPE_EMOJI: Record<string, string> = {
  batch_status: ":beer:",
  order_received: ":inbox_tray:",
  order_status: ":package:",
  po_status: ":truck:",
  inventory_low: ":warning:",
  system: ":gear:",
};

const PRIORITY_INDICATOR: Record<string, string> = {
  high: ":red_circle:",
  normal: "",
  low: ":white_circle:",
};

// -- Helpers ------------------------------------------------------------------

function resolveChannel(
  settings: SlackSettings,
  notificationType: string,
): string | undefined {
  return (
    settings.channel_overrides[notificationType] ??
    settings.default_channel ??
    undefined
  );
}

function buildBlocks(
  notification: SlackNotification,
  appUrl: string | null,
): unknown[] {
  const emoji = TYPE_EMOJI[notification.type] ?? ":bell:";
  const priority = PRIORITY_INDICATOR[notification.priority] ?? "";
  const prefix = [priority, emoji].filter(Boolean).join(" ");

  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${prefix} *${notification.title}*`,
      },
    },
  ];

  if (notification.message) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: notification.message,
      },
    });
  }

  if (notification.action_url && appUrl) {
    const fullUrl = `${appUrl}${notification.action_url}`;
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in MGR", emoji: true },
          url: fullUrl,
          action_id: "view_in_mgr",
        },
      ],
    });
  }

  return blocks;
}

// -- Public API ---------------------------------------------------------------

/**
 * Send a notification to Slack via Incoming Webhook.
 * Returns `{ ok: true }` on success or `{ ok: false, error: string }` on failure.
 */
export async function sendSlackNotification(
  settings: SlackSettings,
  notification: SlackNotification,
  appUrl: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!settings.webhook_url) {
    return { ok: false, error: "No webhook URL configured" };
  }

  const channel = resolveChannel(settings, notification.type);
  const blocks = buildBlocks(notification, appUrl);

  const fallbackText = notification.message
    ? `${notification.title}: ${notification.message}`
    : notification.title;

  const payload: Record<string, unknown> = {
    text: fallbackText,
    blocks,
  };

  if (channel) {
    payload.channel = channel;
  }

  try {
    const res = await fetch(settings.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Slack returned ${res.status}: ${body}` };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Send a test message to validate a Slack webhook URL.
 */
export async function testSlackWebhook(
  webhookUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "MGR test notification - your Slack integration is working!",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":white_check_mark: *MGR Slack Integration Test*\nThis channel is now connected to your brewery management system.",
            },
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Slack returned ${res.status}: ${body}` };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
