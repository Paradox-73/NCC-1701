import pino from 'pino';

export const makeLogger = (level) => pino({ level, base: undefined });
