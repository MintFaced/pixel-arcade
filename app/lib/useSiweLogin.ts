'use client';

import { useCallback, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { getSiweNonce, verifySiweSignature, getSession } from './api';

/**
 * useSiweLogin — handles the full SIWE login flow:
 *   1. Get a nonce from /api/auth/nonce
 *   2. Build a SIWE message
 *   3. Ask wallet to sign it via wagmi
 *   4. POST signature to /api/auth/verify
 *   5. Verify by fetching /api/session
 *
 * Returns { login, isAuthed, authedAddress, signing, error }
 *
 * Call `login()` from any UI that requires auth (e.g. roll button on /mint).
 * After successful login, the session cookie is set and subsequent API calls
 * are authenticated automatically.
 */
export function useSiweLogin() {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authedAddress, setAuthedAddress] = useState<string | null>(null);

  /** Check whether the current cookie session is valid by fetching /session. */
  const checkAuthed = useCallback(async (): Promise<string | null> => {
    try {
      const session = await getSession();
      setAuthedAddress(session.address);
      return session.address;
    } catch {
      setAuthedAddress(null);
      return null;
    }
  }, []);

  /** Run the full SIWE flow. Throws on failure (rejected, etc.) */
  const login = useCallback(async (): Promise<{ address: string } | null> => {
    if (!address) {
      setError('No wallet connected');
      return null;
    }
    setError(null);
    setSigning(true);
    try {
      // 1. Nonce
      const nonce = await getSiweNonce(address);

      // 2. Build SIWE message
      const domain = typeof window !== 'undefined' ? window.location.host : 'pixelarcade.art';
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://pixelarcade.art';
      const message = new SiweMessage({
        domain,
        address,
        statement: 'Sign in to PixelArcade. This will not trigger a blockchain transaction or cost any gas.',
        uri: origin,
        version: '1',
        chainId: chainId ?? 1,
        nonce,
        issuedAt: new Date().toISOString(),
      });

      // 3. Sign with wallet
      const messageText = message.prepareMessage();
      const signature = await signMessageAsync({ message: messageText });

      // 4. Verify on backend (sets cookie)
      const result = await verifySiweSignature(messageText, signature);

      // 5. Confirm session is live
      setAuthedAddress(result.address);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      setError(msg);
      console.error('[siwe-login] Error:', err);
      return null;
    } finally {
      setSigning(false);
    }
  }, [address, chainId, signMessageAsync]);

  return {
    login,
    checkAuthed,
    isAuthed: authedAddress !== null && authedAddress === address?.toLowerCase(),
    authedAddress,
    signing,
    error,
  };
}
