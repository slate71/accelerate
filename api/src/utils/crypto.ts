import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const IV_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * Derives an encryption key from a password using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypts a string using AES-256-GCM
 */
export function encrypt(text: string, password?: string): string {
  const secret = password || process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('Encryption key not configured');
  }

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // Derive key from password
  const key = deriveKey(secret, salt);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt the text
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);

  // Get the auth tag
  const tag = cipher.getAuthTag();

  // Combine salt, iv, tag, and encrypted data
  const combined = Buffer.concat([salt, iv, tag, encrypted]);

  // Return base64 encoded
  return combined.toString('base64');
}

/**
 * Decrypts a string encrypted with encrypt()
 */
export function decrypt(encryptedText: string, password?: string): string {
  const secret = password || process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('Encryption key not configured');
  }

  // Decode from base64
  const combined = Buffer.from(encryptedText, 'base64');

  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  // Derive key from password
  const key = deriveKey(secret, salt);

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  // Decrypt
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Generates a secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hashes a string using SHA256
 */
export function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Validates a hash against a string
 */
export function validateHash(text: string, hash: string): boolean {
  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(crypto.createHash('sha256').update(text).digest('hex'))
  );
}
