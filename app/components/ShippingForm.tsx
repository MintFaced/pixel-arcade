'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import styles from './ShippingForm.module.css';

/**
 * ShippingForm — collects shipping details from a collector who has just
 * paid for one or more physical paintings, and submits to /api/shipping.
 *
 * Pure presentational + form-handling. The parent decides when to render
 * it (e.g. after payment success) and provides the relevant token IDs and
 * payment hash.
 *
 * No PII is stored client-side. The form posts once and is then replaced
 * by a success state. If the user navigates away mid-form, they lose
 * progress — by design.
 */

export interface ShippingFormProps {
  /** Token IDs the user just paid to claim. */
  tokenIds: number[];
  /** Payment tx hash for cross-reference. Optional in case of off-chain pay. */
  paymentTxHash?: string;
  /** Called once the form has been successfully submitted. */
  onSubmitted?: () => void;
}

interface FormState {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  xHandle: string;
  sixtyFiveTwentyNineId: string;
}

const EMPTY: FormState = {
  fullName: '',
  email: '',
  phone: '',
  country: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  region: '',
  postalCode: '',
  xHandle: '',
  sixtyFiveTwentyNineId: '',
};

export function ShippingForm({ tokenIds, paymentTxHash, onSubmitted }: ShippingFormProps) {
  const { address } = useAccount();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const update = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!address) {
      setError('Wallet not connected.');
      return;
    }

    // Minimal client-side validation (server validates again)
    const required: (keyof FormState)[] = [
      'fullName', 'email', 'phone', 'country',
      'addressLine1', 'city', 'region', 'postalCode',
    ];
    for (const f of required) {
      if (!form[f].trim()) {
        setError(`Please fill in: ${f.replace(/([A-Z])/g, ' $1').toLowerCase()}`);
        return;
      }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('Email looks invalid.');
      return;
    }

    setSubmitting(true);
    try {
      const resp = await fetch('/api/shipping', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          country: form.country.trim(),
          addressLine1: form.addressLine1.trim(),
          addressLine2: form.addressLine2.trim() || undefined,
          city: form.city.trim(),
          region: form.region.trim(),
          postalCode: form.postalCode.trim(),
          xHandle: form.xHandle.trim() || undefined,
          sixtyFiveTwentyNineId: form.sixtyFiveTwentyNineId.trim() || undefined,
          walletAddress: address,
          tokenIds,
          paymentTxHash,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error ?? 'Submission failed');
      }
      setSubmitted(true);
      onSubmitted?.();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className={styles.success}>
        <div className={styles.successTitle}>★ SHIPPING DETAILS RECEIVED ★</div>
        <p className={styles.successBody}>
          Thanks. MintFace will be in touch via email when your painting{tokenIds.length !== 1 ? 's are' : ' is'} on the way.
        </p>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.eyebrow}>▼ SHIPPING DETAILS · {tokenIds.length} PAINTING{tokenIds.length !== 1 ? 'S' : ''} ▼</div>
      <p className={styles.lede}>
        Where should we send your painting{tokenIds.length !== 1 ? 's' : ''}? Phone is for courier use only.
      </p>

      <fieldset className={styles.fieldset}>
        <legend>Recipient</legend>
        <label className={styles.field}>
          <span>Full name <em>*</em></span>
          <input type="text" value={form.fullName} onChange={update('fullName')} autoComplete="name" required />
        </label>
        <label className={styles.field}>
          <span>Email <em>*</em></span>
          <input type="email" value={form.email} onChange={update('email')} autoComplete="email" required />
        </label>
        <label className={styles.field}>
          <span>Phone (courier use only) <em>*</em></span>
          <input type="tel" value={form.phone} onChange={update('phone')} autoComplete="tel" required />
        </label>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Address</legend>
        <label className={styles.field}>
          <span>Address line 1 <em>*</em></span>
          <input type="text" value={form.addressLine1} onChange={update('addressLine1')} autoComplete="address-line1" required />
        </label>
        <label className={styles.field}>
          <span>Address line 2</span>
          <input type="text" value={form.addressLine2} onChange={update('addressLine2')} autoComplete="address-line2" />
        </label>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>City <em>*</em></span>
            <input type="text" value={form.city} onChange={update('city')} autoComplete="address-level2" required />
          </label>
          <label className={styles.field}>
            <span>State / Region <em>*</em></span>
            <input type="text" value={form.region} onChange={update('region')} autoComplete="address-level1" required />
          </label>
        </div>
        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>Postal code <em>*</em></span>
            <input type="text" value={form.postalCode} onChange={update('postalCode')} autoComplete="postal-code" required />
          </label>
          <label className={styles.field}>
            <span>Country <em>*</em></span>
            <input type="text" value={form.country} onChange={update('country')} autoComplete="country-name" required />
          </label>
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Identity (optional)</legend>
        <label className={styles.field}>
          <span>X handle</span>
          <input type="text" value={form.xHandle} onChange={update('xHandle')} placeholder="@yourhandle" />
        </label>
        <label className={styles.field}>
          <span>6529 ID</span>
          <input type="text" value={form.sixtyFiveTwentyNineId} onChange={update('sixtyFiveTwentyNineId')} placeholder="6529 handle or wallet" />
        </label>
      </fieldset>

      {error && <div className={styles.error}>★ {error}</div>}

      <button type="submit" className={styles.submit} disabled={submitting}>
        {submitting ? 'SENDING…' : 'CONFIRM SHIPPING ▶'}
      </button>

      <p className={styles.privacy}>
        Your details are emailed directly to MintFace. Nothing is stored online. Phone is shared with courier only.
      </p>
    </form>
  );
}
