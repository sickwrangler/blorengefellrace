import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("scheduler package builder preserves unrelated files and rejects an unverified baseline", () => {
  const result = execFileSync("python3", ["-B", "-c", `
import importlib.util, pathlib, tempfile, zipfile, hashlib, difflib, json
spec=importlib.util.spec_from_file_location('builder','scripts/package-payment-scheduler.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d);source=root/'source.zip';destination=root/'candidate.zip';patch=root/'repair.patch'
 changed=sorted(builder.CHANGED_FILES);guard='src/shared/server/phase3-domain.mjs'
 with zipfile.ZipFile(source,'w') as z:
  for name in changed:z.writestr(name,b'before\\n')
  z.writestr(guard,b'unchanged over-offering safeguard\\n')
  z.writestr('node_modules/synthetic/index.js',b'unchanged dependency\\n')
 patch.write_text(''.join(''.join(difflib.unified_diff(['before\\n'],['after\\n'],fromfile='a/'+name,tofile='b/'+name)) for name in changed))
 builder.VERIFIED_BASE_SHA256=hashlib.sha256(source.read_bytes()).hexdigest()
 evidence=builder.build(source,destination,patch_path=patch)
 with zipfile.ZipFile(source) as before,zipfile.ZipFile(destination) as after:
  assert before.namelist()==after.namelist()
  assert before.read(guard)==after.read(guard)
  assert before.read('node_modules/synthetic/index.js')==after.read('node_modules/synthetic/index.js')
  assert all(after.read(n)==b'after\\n' for n in changed)
 builder.VERIFIED_BASE_SHA256='unverified'
 try:builder.build(source,root/'invalid.zip',patch_path=patch)
 except ValueError:pass
 else:raise AssertionError('Unverified baseline accepted')
 print(json.dumps({'changedFiles':len(evidence['changedFiles']),'allOtherFilesByteIdentical':evidence['allOtherFilesByteIdentical'],'unverifiedBaselineRejected':True}))
`], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(result), {
    changedFiles: 3,
    allOtherFilesByteIdentical: true,
    unverifiedBaselineRejected: true,
  });
});
