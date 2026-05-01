import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';

const buildDir = '../build-wasm';

try {
  if (!existsSync(buildDir)) {
    mkdirSync(buildDir, { recursive: true });
  }

  if (!existsSync(`${buildDir}/CMakeCache.txt`)) {
    console.log('\n[wasm] Configuring CMake project...');
    execSync('emcmake cmake ..', { stdio: 'inherit', cwd: buildDir });
  }

  execSync('cmake --build .', { stdio: 'inherit', cwd: buildDir });
} catch (err) {
  process.exit(1);
}