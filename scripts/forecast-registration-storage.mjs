#!/usr/bin/env node
import { productionStateEntity, PRODUCTION_TABLE_SAFE_ENTITY_BYTES } from "../registration/server/production-storage-codec.mjs";
import { createStorageForecastState } from "./registration-storage-fixtures.mjs";

const scenarios = [[18, false], [60, false], [100, false], [120, false], [120, true]];
const report = scenarios.map(([runners, lifecycleHistory]) => {
  const { measurements } = productionStateEntity("synthetic-forecast", createStorageForecastState(runners, { lifecycleHistory }));
  return { scenario: lifecycleHistory ? `${runners}+history` : String(runners), ...measurements };
});
console.log(JSON.stringify({ conservativeSafeEntityBytes: PRODUCTION_TABLE_SAFE_ENTITY_BYTES, scenarios: report }, null, 2));
