const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('native double-back gate: first press, deadline, expiry and reset', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-back-gate-'));
  const source = path.resolve(__dirname, '../app/src/main/java/com/occharacters/BackExitGate.java');
  const java = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;
  try {
    const runner = path.join(temp, 'BackExitGateTest.java');
    fs.writeFileSync(runner, `package com.occharacters;
public class BackExitGateTest {
  static void check(boolean condition) { if (!condition) throw new AssertionError(); }
  public static void main(String[] args) {
    BackExitGate gate = new BackExitGate();
    check(!gate.press(0)); check(gate.press(1000));
    check(!gate.press(1100)); check(gate.press(3100));
    check(!gate.press(5000)); check(!gate.press(7001)); check(gate.press(7100));
    check(!gate.press(8000)); gate.reset(); check(!gate.press(8100));
    check(!gate.press(100)); check(gate.press(200));
    System.out.println("PASS");
  }
}`);
    execFileSync(java('javac'), ['-d', temp, source, runner], { stdio: 'pipe' });
    assert.match(execFileSync(java('java'), ['-cp', temp, 'com.occharacters.BackExitGateTest'], { encoding: 'utf8' }), /PASS/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
