import { sanitizeDocument, type SanitizeOptions } from '../capture/sanitize';
import './types';

// DEV-ONLY bundle (content/capture.js is built only with --mode development).
globalThis.__jstCapture ??= (opts: SanitizeOptions) => sanitizeDocument(document, location.href, opts);
