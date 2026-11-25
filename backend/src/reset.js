import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'pine.db');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(base + suffix, { force: true });
console.log('Database removed; it is reseeded on the next server start.');
