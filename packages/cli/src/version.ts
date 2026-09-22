import { createRequire } from 'node:module';

/** Package metadata is the source of truth for both reports and the crawler. */
export const TOOL_VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;
