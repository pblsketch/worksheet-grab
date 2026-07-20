#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

run(process.argv.slice(2), { root })
  .then((code) => { process.exitCode = code ?? 0; })
  .catch((err) => {
    console.error(`오류: ${err.message}`);
    process.exitCode = 1;
  });
