import pino from 'pino';
import { env } from './config/env';

export const logger = pino({
  level: env().LOG_LEVEL,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-api-key"]', 'res.headers["set-cookie"]', '*.password', '*.apiKey', '*.keyEnc', '*.ANTHROPIC_API_KEY', '*.GROQ_API_KEY', '*.TOGETHER_API_KEY', '*.OPENAI_COMPATIBLE_API_KEY'],
    censor: '[redacted]',
  },
  transport: env().NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
});
