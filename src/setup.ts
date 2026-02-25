import { checkEnvironment } from './setup-environment.js'
import { validateAuth } from './setup-auth.js'
import { buildContainer, checkContainerImage } from './setup-container.js'
import { runSmokeTest } from './setup-verify.js'
import type { CueclawConfig } from './config.js'
import { logger } from './logger.js'

export async function runSetup(config: CueclawConfig, projectRoot: string): Promise<void> {
  console.log('CueClaw Setup\n')

  // 1. Check environment
  console.log('Checking environment...')
  const env = checkEnvironment()
  console.log(`  Node.js: ${env.nodeVersion}`)

  if (!env.docker) {
    console.log('  Docker: NOT INSTALLED')
    console.log('\n  Docker is required for container isolation.')
    console.log('  Install Docker: https://docs.docker.com/get-docker/')
    console.log('  You can still use CueClaw in local mode (container.enabled: false)')
    return
  }

  console.log(`  Docker: ${env.dockerVersion}`)
  if (!env.dockerRunning) {
    console.log('  Docker daemon: NOT RUNNING')
    console.log('  Please start Docker and try again.')
    return
  }
  console.log('  Docker daemon: running')

  // 2. Validate API key
  console.log('\nValidating API key...')
  const auth = await validateAuth(config)
  if (!auth.valid) {
    console.log(`  API key validation failed: ${auth.error}`)
    console.log('  Check your ANTHROPIC_API_KEY in ~/.cueclaw/config.yaml or .env')
    return
  }
  console.log('  API key: valid')

  // 3. Build container image
  const imageName = config.container?.image ?? 'cueclaw-agent:latest'
  if (!checkContainerImage(imageName)) {
    console.log('\nBuilding container image...')
    const build = buildContainer(projectRoot)
    if (!build.success) {
      console.log(`  Build failed: ${build.error}`)
      return
    }
    console.log(`  Image built: ${imageName}`)
  } else {
    console.log(`\nContainer image: ${imageName} (exists)`)
  }

  // 4. Smoke test
  console.log('\nRunning smoke test...')
  const smoke = runSmokeTest(imageName)
  if (!smoke.success) {
    console.log(`  Smoke test failed: ${smoke.error}`)
    logger.warn({ error: smoke.error }, 'Setup smoke test failed')
    return
  }
  console.log('  Smoke test: passed')

  console.log('\nSetup complete. Run `cueclaw daemon install` to start the background service.')
}
