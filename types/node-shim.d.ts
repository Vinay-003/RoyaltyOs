declare const process: any;
declare const Buffer: any;
declare namespace NodeJS { interface ProcessEnv { [key: string]: string | undefined } }
declare module "node:http" { export type IncomingMessage = any; export type ServerResponse = any; export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => any): any; }
declare module "node:crypto" { export const createHash: any; export const randomUUID: any; export const timingSafeEqual: any; }
declare module "node:fs" { export const readFileSync: any; export const existsSync: any; export const readdirSync: any; export const mkdirSync: any; export const writeFileSync: any; export const copyFileSync: any; export const statSync: any; }
declare module "node:fs/promises" { export const readFile: any; export const writeFile: any; export const mkdir: any; export const readdir: any; export const cp: any; }
declare module "node:path" { const x: any; export default x; export const join: any; export const dirname: any; export const extname: any; export const resolve: any; }
declare module "node:url" { export const fileURLToPath: any; }
declare module "node:net" { export const createConnection: any; }
declare module "node:test" { const test: any; export default test; export const describe: any; export const it: any; export const before: any; export const after: any; }
declare module "node:assert/strict" { const assert: any; export default assert; }
declare module "node:child_process" { export const spawnSync: any; }
