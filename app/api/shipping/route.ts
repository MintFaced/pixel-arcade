import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

/**
 * POST /api/shipping
 *
 * Receives a shipping form submission after a successful physical-claim
 * payment, and emails the details to MintFace. No database — email is the
 * record. Fields are kept minimal but include everything a courier needs.
 *
 * Required env vars:
 *   RESEND_API_KEY            — from https://resend.com (free tier ok)
 *   SHIPPING_FORM_RECIPIENT   — destination email (defaults to mintface@digitalartisteconomy.com)
 *   SHIPPING_FORM_FROM        — verified sender domain on Resend
 *                                (defaults to 'PixelArcade <noreply@pixelarcade.art>')
 *
 * Without RESEND_API_KEY set, the route logs to console and returns ok
 * so dev/preview environments don't break the form UX.
 */

interface ShippingPayload {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region: string;
  postalCode: string;
  xHandle?: string;
  sixtyFiveTwentyNineId?: string;
  walletAddress: string;
  tokenIds: number[];
  paymentTxHash?: string;
}

const REQUIRED: (keyof ShippingPayload)[] = [
  'fullName', 'email', 'phone', 'country',
  'addressLine1', 'city', 'region', 'postalCode',
  'walletAddress', 'tokenIds',
];

function validate(body: unknown): body is ShippingPayload {
  if (!body || typeof body !== 'object') return false;
  const p = body as Record<string, unknown>;
  for (const f of REQUIRED) {
    const v = p[f];
    if (f === 'tokenIds') {
      if (!Array.isArray(v) || v.length === 0) return false;
      if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) return false;
      continue;
    }
    if (typeof v !== 'string' || v.trim() === '') return false;
  }
  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildEmail(payload: ShippingPayload): { subject: string; html: string; text: string } {
  const tokenList = payload.tokenIds.map((t) => `#${String(t).padStart(2, '0')}`).join(', ');
  const subject = `★ PIXELARCADE SHIPPING · ${payload.fullName} · ${payload.tokenIds.length} painting${payload.tokenIds.length !== 1 ? 's' : ''}`;

  // Pretty-printed HTML for reading in mail client
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace; max-width: 640px;">
      <h2 style="color:#CB02B2;">★ NEW PHYSICAL CLAIM ★</h2>
      <p>A collector has paid for their physical paintings and submitted shipping details.</p>

      <h3>Recipient</h3>
      <ul>
        <li><strong>Name:</strong> ${escapeHtml(payload.fullName)}</li>
        <li><strong>Email:</strong> ${escapeHtml(payload.email)}</li>
        <li><strong>Phone (courier only):</strong> ${escapeHtml(payload.phone)}</li>
      </ul>

      <h3>Shipping Address</h3>
      <p>
        ${escapeHtml(payload.addressLine1)}<br>
        ${payload.addressLine2 ? escapeHtml(payload.addressLine2) + '<br>' : ''}
        ${escapeHtml(payload.city)}, ${escapeHtml(payload.region)} ${escapeHtml(payload.postalCode)}<br>
        ${escapeHtml(payload.country)}
      </p>

      <h3>Tokens to ship</h3>
      <p style="font-family: monospace; font-size:16px;"><strong>${tokenList}</strong></p>

      <h3>Social / Identity</h3>
      <ul>
        <li><strong>Wallet:</strong> <code>${escapeHtml(payload.walletAddress)}</code></li>
        ${payload.xHandle ? `<li><strong>X handle:</strong> ${escapeHtml(payload.xHandle)}</li>` : ''}
        ${payload.sixtyFiveTwentyNineId ? `<li><strong>6529 ID:</strong> ${escapeHtml(payload.sixtyFiveTwentyNineId)}</li>` : ''}
        ${payload.paymentTxHash ? `<li><strong>Payment tx:</strong> <code>${escapeHtml(payload.paymentTxHash)}</code></li>` : ''}
      </ul>

      <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
      <p style="font-size:12px;color:#666;">PixelArcade automated shipping notification · pixelarcade.art</p>
    </div>
  `.trim();

  const text = [
    'NEW PHYSICAL CLAIM',
    '',
    `Name: ${payload.fullName}`,
    `Email: ${payload.email}`,
    `Phone: ${payload.phone}`,
    '',
    'Address:',
    payload.addressLine1,
    payload.addressLine2 ?? '',
    `${payload.city}, ${payload.region} ${payload.postalCode}`,
    payload.country,
    '',
    `Tokens: ${tokenList}`,
    '',
    `Wallet: ${payload.walletAddress}`,
    payload.xHandle ? `X: ${payload.xHandle}` : '',
    payload.sixtyFiveTwentyNineId ? `6529: ${payload.sixtyFiveTwentyNineId}` : '',
    payload.paymentTxHash ? `Payment tx: ${payload.paymentTxHash}` : '',
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!validate(body)) {
    return NextResponse.json({ error: 'Missing or invalid required fields' }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const recipient = process.env.SHIPPING_FORM_RECIPIENT ?? 'mintface@digitalartisteconomy.com';
  const from = process.env.SHIPPING_FORM_FROM ?? 'PixelArcade <noreply@pixelarcade.art>';
  const { subject, html, text } = buildEmail(body);

  // Dev/preview fallback — log and succeed when Resend isn't configured.
  if (!apiKey) {
    console.warn('[shipping] RESEND_API_KEY not set — logging payload instead of emailing');
    console.log('[shipping] To:', recipient);
    console.log('[shipping] Subject:', subject);
    console.log('[shipping] Body:', text);
    return NextResponse.json({ ok: true, mocked: true });
  }

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to: recipient,
      replyTo: body.email,
      subject,
      html,
      text,
    });
    if (result.error) {
      console.error('[shipping] Resend error:', result.error);
      return NextResponse.json({ error: 'Email send failed' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, id: result.data?.id });
  } catch (err) {
    console.error('[shipping] Unexpected error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
