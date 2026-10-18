export { CryptoError, classify, envelopeKid, isEnvelope, isLegacyCiphertext, openBytes, openJson, openString, rewrap, sealBytes, sealJson, sealString, tryOpenAny } from '@/lib/security/crypto/envelope';
export type { CryptoErrorCode, SealState } from '@/lib/security/crypto/envelope';
export { kekFromHex, loadKeyring, requireActiveKek } from '@/lib/security/crypto/keyring';
export type { Kek, Keyring } from '@/lib/security/crypto/keyring';
export { CAS_HSET, inspectSealedHash, rotateSealedHash, sumReports } from '@/lib/security/crypto/rotation';
export type { RotationReport, SealedHash } from '@/lib/security/crypto/rotation';
