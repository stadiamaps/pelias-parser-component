import { nodeResolve } from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import dynamicImportVars from '@rollup/plugin-dynamic-import-vars'

export default {
  input: 'index.js',
  output: {
    file: 'dist/parser.bundled.js',
    format: 'es',
  },
  plugins: [
    commonjs(),
    nodeResolve(),
    dynamicImportVars(),
  ],
}
