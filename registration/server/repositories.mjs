import fs from "node:fs";
import path from "node:path";

const clone = (value) => structuredClone(value);

export function createMemoryRepository(initialState) {
  let state = clone(initialState);
  let queue = Promise.resolve();
  return {
    kind: "isolated-memory",
    async read() { await queue; return clone(state); },
    transaction(operation) {
      const run = queue.then(async () => {
        const working = clone(state);
        const result = await operation(working);
        if (result?.ok !== false) state = working;
        return clone(result);
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
    async reset(nextState) { await queue; state = clone(nextState); return clone(state); },
    async backup() { return JSON.stringify(await this.read(), null, 2); },
    async restore(serialized) { const parsed = JSON.parse(serialized); await this.reset(parsed); return this.read(); }
  };
}

export function createJsonFileRepository(filePath, initialState) {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(absolute)) fs.writeFileSync(absolute, JSON.stringify(initialState, null, 2), { mode: 0o600 });
  let queue = Promise.resolve();
  const readFile = () => JSON.parse(fs.readFileSync(absolute, "utf8"));
  const writeFile = (state) => {
    const temporary = `${absolute}.next`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, absolute);
  };
  return {
    kind: "persistent-json-file",
    filePath: absolute,
    async read() { await queue; return clone(readFile()); },
    transaction(operation) {
      const run = queue.then(async () => {
        const state = readFile();
        const result = await operation(state);
        if (result?.ok !== false) writeFile(state);
        return clone(result);
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
    async reset(nextState) { await queue; writeFile(nextState); return clone(nextState); },
    async backup() { await queue; return fs.readFileSync(absolute, "utf8"); },
    async restore(serialized) { const parsed = JSON.parse(serialized); await this.reset(parsed); return this.read(); }
  };
}

// Review-only Azure adapter contract. Its injected implementation must use an
// ETag-guarded Table transaction for every mutation in one event partition.
export function createAzureTableRepository({ loadPartition, submitTransaction }) {
  let queue = Promise.resolve();
  const maximumAttempts = 5;
  return {
    kind: "azure-table-etag-transaction",
    async read() { const snapshot = await loadPartition(); return clone(snapshot.state); },
    transaction(operation) {
      const run = queue.then(async () => {
        for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
          const snapshot = await loadPartition();
          const working = clone(snapshot.state);
          const result = await operation(working);
          if (result?.ok === false) return clone(result);
          try {
            await submitTransaction({ before: snapshot.state, after: working, etag: snapshot.etag });
            return clone(result);
          } catch (error) {
            const conflict = error?.statusCode === 409 || error?.statusCode === 412;
            if (!conflict || attempt === maximumAttempts) throw error;
          }
        }
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
    async reset(nextState) {
      return this.transaction((working) => {
        for (const key of Object.keys(working)) delete working[key];
        Object.assign(working, clone(nextState));
        return { ok: true, state: clone(nextState) };
      });
    },
    async backup() { return JSON.stringify(await this.read(), null, 2); },
    async restore(serialized) { const parsed = JSON.parse(serialized); await this.reset(parsed); return this.read(); }
  };
}
