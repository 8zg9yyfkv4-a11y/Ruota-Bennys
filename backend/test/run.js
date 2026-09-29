const { spawnSync } = require('node:child_process')
for (const postgres of ['false', 'true']) {
  const result = spawnSync(process.execPath, ['--test', 'test/catalog.test.js'], { stdio: 'inherit', env: { ...process.env, TEST_POSTGRES: postgres } })
  if (result.status !== 0) process.exit(result.status || 1)
}
