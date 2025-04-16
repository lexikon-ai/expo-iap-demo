// ref: https://github.com/toastclub/iap/blob/4c5d1066343f000cbf62b0c33639e25915a39806/js/src/apple/transaction/crypto.ts
// (heavily modified to make it actually work)
// (can't use the functions from `app-store-server-api` because they do not work with Cloudflare Workers)

import {
  KeyUsageFlags,
  KeyUsagesExtension,
  type PublicKey,
  X509Certificate
} from '@peculiar/x509';
import { decodeJwt, jwtVerify } from 'jose';

const MAX_SKEW = 60000;

// downloaded from  https://apple.com/certificateauthority/AppleRootCA-G3.cer
// converted to base64 with cat AppleRootCA-G3.cer | base64
const APPLE_ROOT_CERTIFICATE = new X509Certificate(
  'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA=='
);

function checkDates(cert: X509Certificate, effectiveDate: Date) {
  if (
    new Date(cert.notBefore).getTime() > effectiveDate.getTime() + MAX_SKEW ||
    new Date(cert.notAfter).getTime() < effectiveDate.getTime() - MAX_SKEW
  ) {
    throw new Error(
      'Certificate chain verification failed: not valid at effective date'
    );
  }
}

export async function verifyAppleJWT<T>(jwt: string): Promise<T> {
  const decodedJwt = decodeJwt(jwt);

  const header = JSON.parse(
    Buffer.from(jwt.split('.')[0], 'base64url').toString('utf-8')
  );
  const chain: string[] = header.x5c;
  if (!chain || chain.length !== 3) {
    throw new Error('Invalid certificate chain length');
  }

  const leaf = new X509Certificate(chain[0]);
  const intermediate = new X509Certificate(chain[1]);
  const effectiveDate = decodedJwt.exp
    ? new Date(decodedJwt.exp * 1000)
    : undefined;
  const publicKey = await verifyCertificateChain(
    leaf,
    intermediate,
    [APPLE_ROOT_CERTIFICATE],
    effectiveDate
  );
  const cryptoKey = await publicKey.export();
  const verify = await jwtVerify<T>(jwt, cryptoKey);
  return verify.payload;
}

async function verifyCertificateChain(
  leaf: X509Certificate,
  intermediate: X509Certificate,
  roots: X509Certificate[],
  effectiveDate?: Date
): Promise<PublicKey> {
  let rootCert: X509Certificate | undefined;
  for (const root of roots) {
    if (
      (await intermediate.verify({
        publicKey: root.publicKey
      })) &&
      intermediate.issuer === root.subject
    ) {
      rootCert = root;
      break;
    }
  }
  if (!rootCert) {
    throw new Error('Certificate chain verification failed: no root found');
  }
  if (
    !(await leaf.verify({ publicKey: intermediate.publicKey })) ||
    leaf.issuer !== intermediate.subject
  ) {
    throw new Error(
      'Certificate chain verification failed: leaf not signed by intermediate'
    );
  }
  // Check if leaf is a CA
  {
    // cRLSign = 64,
    const keyUsage = leaf.getExtension(KeyUsagesExtension);
    if (!keyUsage || (keyUsage.usages & KeyUsageFlags.cRLSign) !== 0)
      throw new Error(
        'Certificate chain verification failed: leaf is not a CA'
      );
  }
  // ensure leaf has 1.2.840.113635.100.6.11.1 extension and intermediate has 1.2.840.113635.100.6.2.1 extension
  // https://developer.apple.com/forums/thread/78079
  const leafExtension = leaf.getExtension('1.2.840.113635.100.6.11.1');
  if (!leafExtension) {
    throw new Error(
      'Certificate chain verification failed: missing receipt extension on leaf'
    );
  }

  const intermediateExtension = intermediate.getExtension(
    '1.2.840.113635.100.6.2.1'
  );
  if (!intermediateExtension) {
    throw new Error(
      'Certificate chain verification failed: missing receipt extension on intermediate'
    );
  }
  // Check dates
  if (effectiveDate) {
    [leaf, intermediate, rootCert].forEach((cert) =>
      checkDates(cert, effectiveDate)
    );
  }
  return leaf.publicKey;
}
