import pino from 'pino';
import { env } from './config/env';

export const logger = pino({
  level: env().LOG_LEVEL,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password'],
    censor: '[redacted]',
  },
  transport: env().NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
});
