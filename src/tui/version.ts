import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const pkg = require('../../package.json') as { version: string }

const isDev = !fileURLToPath(import.meta.url).includes('/dist/')

export const appVersion = isDev ? 'dev' : pkg.version
