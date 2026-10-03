import test from 'node:test';
import assert from 'node:assert/strict';
import {browserLaunchError} from '../src/browser/session.mjs';

test('browser ownership errors give an actionable message without Chromium logs',()=>{
  for(const message of [
    'browserType.launchPersistentContext: Opening in existing browser session.\nCall log: \u001b[2m - <launching> /private/browser --user-data-dir=/private/profile\u001b[22m',
    'browserType.launchPersistentContext: Failed to create /private/profile/SingletonLock: File exists (17)',
    'browserType.launchPersistentContext: The user data directory is already in use'
  ]){
    const error=browserLaunchError(new Error(message));
    assert.match(error.message,/profile is already open/i);
    assert.match(error.message,/close.*Open LinkedIn/i);
    assert.doesNotMatch(error.message,/Call log|SingletonLock|\u001b|\/private\/|--user-data-dir/);
  }
});

test('other browser launch errors keep installation help or a concise reason',()=>{
  assert.match(browserLaunchError(new Error("Executable doesn't exist at /private/chrome")).message,/npm run browser:install/);
  assert.equal(browserLaunchError(new Error('browserType.launchPersistentContext: Browser crashed\nCall log:\n\u001b[2m<launching> private flags\u001b[22m')).message,'Could not open Chromium: Browser crashed');
});
