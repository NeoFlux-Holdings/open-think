/**
 * Barrel export for the Web Push module. Consumers should import from here
 * instead of reaching into individual files.
 */

export {
  generateVapidKeys,
  signVapidJwt,
  buildVapidAuthHeader,
  audienceFromEndpoint,
  importVapidPublicKey,
  type VapidKeys,
  type VapidSigningInput
} from "./vapid";

export {
  encryptWebPushPayload,
  MAX_PLAINTEXT_BYTES,
  _decryptForTests,
  type EncryptInput,
  type EncryptOutput
} from "./encrypt";

export {
  sendWebPushNotification,
  buildPushPayload,
  type PushSubscription,
  type VapidConfig,
  type PushOptions,
  type PushResult
} from "./push";

export { base64UrlDecode, base64UrlEncode, base64UrlEncodeString } from "./base64url";

export { SERVICE_WORKER_JS, ICON_SVG } from "./serviceWorker";
