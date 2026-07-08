import { readFileSync, writeFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const parts = pkg.version.split('.').map(Number)
parts[2] += 1
pkg.version = parts.join('.')
writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n')
console.log(`Version bumped to ${pkg.version}`)
